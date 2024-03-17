const express = require('express');
const multer = require('multer');
const { SQSClient, SendMessageCommand, GetQueueAttributesCommand } = require("@aws-sdk/client-sqs");
const { AutoScalingClient, SetDesiredCapacityCommand, DescribeScalingActivitiesCommand } = require("@aws-sdk/client-auto-scaling");
const { Consumer } = require('sqs-consumer');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 8080;
const upload = multer({ dest: 'uploads/' });

// Initialize AWS clients
const sqsClient = new SQSClient({ region: "us-east-2" });
const autoScalingClient = new AutoScalingClient({ region: "us-east-2" });

const URL_REQUEST_SQS = "https://sqs.us-east-2.amazonaws.com/992382822519/RequestQueue-1";
const URL_RESPONSE_SQS = "https://sqs.us-east-2.amazonaws.com/992382822519/ResponseQueue-1";
const ASG_NAME = 'WebTierAutoScaling';

// Storage for pending requests
const pendingRequests = new Map();

// Tracking for scale-in and scale-out
let lastActivityTime = Date.now();
let lastScaleInReqTime = Date.now();
let scaleOutCooldown = false;


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
        lastActivityTime = Date.now(); // Update last activity time
    } catch (error) {
        console.error("Error sending message to SQS:", error);
        res.status(500).send('Failed to process the file upload.');
    }
});

async function adjustScaling() {
	const scalingInProgress = await checkIfScalingActivityInProgress(ASG_NAME);

	if (scalingInProgress) {
        console.log('A scaling operation is already in progress. Skipping...');
        return;
    }
	
    const queueLength = await getQueueLength(URL_REQUEST_SQS);
    const currentTime = Date.now();
    const timeSinceLastActivity = (currentTime - lastActivityTime) / 1000; // Convert to seconds
	const timeSinceLastScaleIn = (currentTime - lastScaleInReqTime) / 1000;
	
    // Scale down after 30 seconds of inactivity
    if (timeSinceLastActivity > 30 && timeSinceLastScaleIn > 30) {
        console.log('Scaling down due to inactivity.');
        await setDesiredCapacity(ASG_NAME, 0);
		lastScaleInReqTime = Date.now();
    } else if (!scaleOutCooldown || (currentTime - lastActivityTime) >= 15000) { // 15 seconds cooldown for additional scale-out
        if (queueLength > 0) {
            console.log('Scaling out due to activity.');
            const desiredCapacity = Math.min(Math.max(1, queueLength), 5); // Adjust desired capacity based on queue
            await setDesiredCapacity(ASG_NAME, desiredCapacity);
            scaleOutCooldown = true;
            setTimeout(() => { scaleOutCooldown = false; }, 15000); // Reset scale-out cooldown after 15 seconds
        }
    }
}

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

async function setDesiredCapacity(asgName, desiredCapacity) {

	const command = new SetDesiredCapacityCommand({
        AutoScalingGroupName: asgName,
        DesiredCapacity: desiredCapacity,
        HonorCooldown: true,
    });

    try {
		const scalingInProgress = await checkIfScalingActivityInProgress(ASG_NAME);

		if (scalingInProgress) {
			console.log('A scaling operation is already in progress. Skipping...');
			return;
		}
        await autoScalingClient.send(command);
        console.log(`Adjusted desired capacity to ${desiredCapacity}.`);
    } catch (error) {
        console.error('Failed to adjust desired capacity:', error);
		// Check for the ScalingActivityInProgressFault error
        if (error.name === 'ScalingActivityInProgressFault') {
            console.log('Scaling activity is in progress, will retry later.');
        }
    }finally {
        // Reset the flag after the operation completes or fails

    }
}

async function checkIfScalingActivityInProgress(asgName) {
    const command = new DescribeScalingActivitiesCommand({
        AutoScalingGroupName: asgName,
        // Optionally, you can specify a maximum number of activities to return
        // MaxRecords: 1
    });

    try {
        const response = await autoScalingClient.send(command);
        const activities = response.Activities;

        // Filter for in-progress activities
        const inProgressActivities = activities.filter(activity => activity.StatusCode === 'InProgress');

        if (inProgressActivities.length > 0) {
            console.log('There is a scaling activity in progress.');
            return true; // Indicates that there is a scaling activity in progress
        } else {
            console.log('No scaling activities are in progress.');
            return false; // Indicates that there are no scaling activities in progress
        }
    } catch (error) {
        console.error('Failed to retrieve scaling activities:', error);
        throw error;
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

// Periodically adjust the ASG based on the SQS queue length and activity
setInterval(adjustScaling, 3000); // Check every 3 seconds

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
