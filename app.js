const express = require('express');
const multer = require('multer');
const { SQSClient, SendMessageCommand, GetQueueAttributesCommand } = require("@aws-sdk/client-sqs");
const { AutoScalingClient, SetDesiredCapacityCommand, DescribeScalingActivitiesCommand } = require("@aws-sdk/client-auto-scaling");
const { Consumer } = require('sqs-consumer');
const { v4: uuidv4 } = require('uuid');
const { EC2Client, RunInstancesCommand, TerminateInstancesCommand } = require("@aws-sdk/client-ec2");

const app = express();
const port = 8080;
const upload = multer({ dest: 'uploads/' });

// Initialize AWS clients
const sqsClient = new SQSClient({ region: "us-east-2" });
const ec2Client = new EC2Client({ region: "us-east-2" });

const URL_REQUEST_SQS = "https://sqs.us-east-2.amazonaws.com/992382822519/RequestQueue-1";
const URL_RESPONSE_SQS = "https://sqs.us-east-2.amazonaws.com/992382822519/ResponseQueue-1";
const ASG_NAME = 'WebTierAutoScaling';
const APP_TIER_AMI_ID = 'ami-0b366c4eac5626dfe'
const KEY_PAIR_LOGIN_NAME = "my_key_pair_cloud_assnmnt"
const IAM_ROLE = "s3-fullAccess"
const SECURITY_GROUP_ID = "sg-04295adadef148233"
const START_SCRIPT = `#!/bin/bash
cd /home/ec2-user/
sudo -u ec2-user node appTier.js`;

// Thresholds for scaling actions
const SCALE_OUT_THRESHOLD = 5;
const SCALE_IN_THRESHOLD = 0;
const SCALE_CHECK_INTERVAL = 10000;
const MAX_INSTANCES = 10;
const MIN_INSTANCES = 0;

// Storage for pending requests
const pendingRequests = new Map();
const ec2InstanceSet = new Set();

// Tracking for scale-in and scale-out
let lastActivityTime = Date.now();
let lastScaleInReqTime = Date.now();
let scaleOutCooldown = false;

let instanceCount = 0;

app.post('/', upload.single('inputFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const correlationId = uuidv4();
    const messageBody = JSON.stringify({
        filename: req.file.originalname,
        filePath: req.file.path,
        correlationId,
    });

    try {
        await sendMessageToSQS(URL_REQUEST_SQS, messageBody);
        console.log('Request sent to SQS:', correlationId);
        // Store the response object to use later once the response message is received
        pendingRequests.set(correlationId, res);
		if (instanceCount == 0)
		{
			console.log('post API, no ec2Instance found');
			await manageScaling();
		}
        lastActivityTime = Date.now(); // Update last activity time
    } catch (error) {
        console.error("Error sending message to SQS:", error);
        res.status(500).send('Failed to process the file upload.');
    }
});

// Helper function to send message to SQS
const sendMessageToSQS = async (queueUrl, messageBody) => {
    const params = {
        QueueUrl: queueUrl,
        MessageBody: messageBody,
    };

    try {
        const data = await sqsClient.send(new SendMessageCommand(params));
        console.log("Success, message sent. Message ID:", data.MessageId);
        return data;
    } catch (error) {
        console.error("Error", error);
        throw error;
    }
};

async function getQueueLength(queueUrl) {
    const command = new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages'],
    });
    const response = await sqsClient.send(command);
    return parseInt(response.Attributes.ApproximateNumberOfMessages, 10);
}

async function launchNewInstance() {
    const params = {
        ImageId: APP_TIER_AMI_ID,
        InstanceType: "t2.micro",
        MinCount: 1,
        MaxCount: 1,
        // Include additional configuration as needed (e.g., security groups, key pair, subnet ID)
        KeyName: KEY_PAIR_LOGIN_NAME,
        SecurityGroupIds: [SECURITY_GROUP_ID],
		IamInstanceProfile: {
			Name: IAM_ROLE
		},
		UserData: Buffer.from(START_SCRIPT).toString('base64')
    };

    try {
		if (instanceCount >= MAX_INSTANCES)
		{
			console.log('max instances reached, increase total limit')
			return
		}
		instanceCount++;
        const data = await ec2Client.send(new RunInstancesCommand(params));
        console.log("Successfully launched instance", data.Instances[0].InstanceId);
		ec2InstanceSet.add(data.Instances[0].InstanceId);

        // Additional setup or tagging can be done here
    } catch (error) {
        console.error("Failed to launch instance:", error);
		instanceCount--;
    }
}


async function terminateInstance(instanceId) {
    const params = {
        InstanceIds: [instanceId],
    };

    try {
		instanceCount--;
        await ec2Client.send(new TerminateInstancesCommand(params));
        console.log(`Successfully requested termination of instance ${instanceId}`);
		ec2InstanceSet.delete(instanceId);
    } catch (error) {
		instanceCount++;
        console.error("Failed to terminate instance:", error);
    }
}


async function manageScaling() {
    const pendingSize = pendingRequests.size;
	console.log("checking scaling");
	console.log("instanceCount = ", instanceCount);
	console.log("pendingSize = ", pendingSize);
	if (instanceCount == 0 && pendingSize > 0)
	{
		console.log("No instance detected, launching right away");
		await launchNewInstance();
	}
	
    // Scale Out: If pending requests exceed the threshold, launch a new instance.
    else if (pendingSize / instanceCount >= SCALE_OUT_THRESHOLD && instanceCount < MAX_INSTANCES) {
        console.log("Scaling out due to high load...");
        await launchNewInstance();
    }
    // Scale In: If the load decreases significantly, terminate an instance.
    else if (pendingSize <= SCALE_IN_THRESHOLD && instanceCount > MIN_INSTANCES) {
        console.log("Scaling in due to low load...");
		const iterator = ec2InstanceSet.values();
		const first = iterator.next().value;
        await terminateInstance(first);
    }
}

// SQS Consumer to process response messages
const responseConsumer = Consumer.create({
    queueUrl: URL_RESPONSE_SQS,
    handleMessage: async (message) => {
        console.log("Received response message:", message.Body);
        const response = JSON.parse(message.Body);

        // Extract correlationId from the response
        const { correlationId, result } = response;

        // Check if the correlationId exists in the pendingRequests map
        if (pendingRequests.has(correlationId)) {
            const clientRes = pendingRequests.get(correlationId);
            clientRes.send({ message: 'File processing completed.', result });
            pendingRequests.delete(correlationId); // Remove the request from the map
        } else {
            console.log("No matching request found for correlationId:", correlationId);
        }
    },
    sqs: sqsClient,
});

responseConsumer.on('error', (err) => {
    console.error('Error in response consumer:', err.message);
});

responseConsumer.on('processing_error', (err) => {
    console.error('Processing error in response consumer:', err.message);
});

responseConsumer.start();

setInterval(() => {
        manageScaling();
    }, SCALE_CHECK_INTERVAL);

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
