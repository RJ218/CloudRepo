/*// Load required modules
const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand } = require("@aws-sdk/client-sqs");
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { exec } = require("child_process");
const fs = require("fs").promises;
const path = require("path");
const util = require("util");
const stream = require("stream");
const execAsync = util.promisify(exec);


image_folder_path = '/home/ec2-user/CSE546-Cloud-Computing-main/dataset/face_images_1000'
face_recogintion_model = '/home/ec2-user/CSE546-Cloud-Computing-main/model/face_recognition.py'

const REGION = "us-east-2"; // Replace with your region
const URL_RESPONSE_SQS = "https://sqs.us-east-2.amazonaws.com/992382822519/ResponseQueue-1"
const URL_REQUEST_SQS = "https://sqs.us-east-2.amazonaws.com/992382822519/RequestQueue-1"
const URL_INPUT_S3 = ""
const URL_OUTPUT_S3 = ""
const INPUT_BUCKET_NAME = "asuid-in-bucket"
const OUTPUT_BUCKET_NAME = "asu-id-out-bucket"

// Helper function to download a file from S3
const downloadFileFromS3 = async (bucket, key, downloadPath) => {
  const params = {
    Bucket: bucket,
    Key: key,
  };

  const { Body } = await s3Client.send(new GetObjectCommand(params));
  const finished = util.promisify(stream.finished);
  const writeStream = fs.createWriteStream(downloadPath);
  Body.pipe(writeStream);
  await finished(writeStream); // Wait until file is written
};

// Helper function to run Python script and return the output
const runPythonScript = async (filename) => {
try {
    const imagePath = path.join(image_folder_path, filename);

    // Ensure the file exists using the promise-based fs API
    await fs.access(imagePath, fs.constants.F_OK);

    console.log('Start executing Python script');
    
    // Execute the Python script with the image path
    const { stdout, stderr } = await execAsync(`python3 "${face_recogintion_model}" "${imagePath}"`, { maxBuffer: 1024 * 1024 });

    if (stderr) {
      console.error('Python script stderr:', stderr);
      throw new Error(stderr);
    }

    console.log('Python script executed successfully');
    return stdout.trim();
  } catch (error) {
    console.error("Error in runPythonScript:", error);
    throw error; // Rethrow to handle it in the calling function
  }
};


// Create SQS and S3 service objects
const sqsClient = new SQSClient({ region: REGION });
const s3Client = new S3Client({ region: REGION });

async function getImageFileContent(imagePath) {
    try {
        const fileContent = await fs.readFile(imagePath); // This returns a Buffer
        return fileContent;
    } catch (error) {
        console.error("Error reading file:", error);
        throw error;
    }
}

const pollSQS = async () => {
  const receiveMessageParams = {
    QueueUrl: URL_REQUEST_SQS,
    MaxNumberOfMessages: 1,
    WaitTimeSeconds: 20, // Enable long polling
  };

  try {
    const data = await sqsClient.send(new ReceiveMessageCommand(receiveMessageParams));
    if (data.Messages) {
      for (const message of data.Messages) {
        console.log("Received message:", message.Body);
        
        // Assume the message body contains the S3 bucket and key JSON
        const { filename, correlationId } = JSON.parse(message.Body);
		const imagePath = path.join(image_folder_path, filename);
		console.log('filename, imagepath', filename, imagePath)
		try
		{
			const fileContent = await getImageFileContent(imagePath);
			uploadFileToS3(fileContent, INPUT_BUCKET_NAME, filename)

		} catch(fileReadError) 
		{
			console.error("Error reading file:", fileReadError);
		}
		
        console.log("Result uploaded to input s3:", filename);

        // Run the Python model script with the downloaded image
        const result = await runPythonScript(filename);
        console.log("Model output:", result);

		uploadFileToS3(result, OUTPUT_BUCKET_NAME, filename)
		
		deleteMessageFromSQS(URL_REQUEST_SQS, message.ReceiptHandle)
        
		// SQS message body
        const sqsMessageBody = JSON.stringify({
            filename,
            result,
			correlationId
        });
		
		sendMessageToSQS(URL_RESPONSE_SQS, sqsMessageBody)
		
      }
    } else {
      console.log("No messages to process");
    }
  } catch (err) {
    console.log("Error", err);
  }

  // Continue polling
  pollSQS();
};

// Start polling
pollSQS();


async function sendMessageToSQS(queueUrl, messageBody) {
    // Set the parameters
    const params = {
        QueueUrl: queueUrl,
        MessageBody: messageBody,
    };

    try {
        // Send the message
        const data = await sqsClient.send(new SendMessageCommand(params));
        console.log("Success, message sent. Message ID:", data.MessageId);
        return data;
    } catch (error) {
        console.error("Error", error);
        throw error;
    }
}

/**
 * Deletes a message from an SQS queue.
 * 
 * @param {string} queueUrl The URL of the SQS queue from which the message should be deleted.
 * @param {string} receiptHandle The receipt handle of the message to delete.
 
async function deleteMessageFromSQS(queueUrl, receiptHandle) {
    // Set the parameters for the DeleteMessageCommand
    const params = {
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
    };

    try {
        // Send the delete message command
        await sqsClient.send(new DeleteMessageCommand(params));
        console.log("Message deleted successfully.");
    } catch (error) {
        console.error("Error deleting message:", error);
    }
}


/**
 * Uploads a file to an S3 bucket.
 * 
 * @param {Buffer|string|Uint8Array|Blob|ReadableStream|Readable} fileContent The content of the file to upload.
 * @param {string} bucketName The name of the bucket to which the file is uploaded.
 * @param {string} key The key (file name) under which to store the file in the bucket.
 
async function uploadFileToS3(fileContent, bucketName, key) {
    // Create an S3 client
    const s3Client = new S3Client({
		region: REGION
	});

    // Set the parameters for the PutObjectCommand
    const uploadParams = {
        Bucket: bucketName,
        Key: key,
        Body: fileContent,
    };

    try {
        // Upload the file
        const data = await s3Client.send(new PutObjectCommand(uploadParams));
        console.log("File uploaded successfully. Location:", `https://${bucketName}.s3.amazonaws.com/${key}`);
        return data;
    } catch (error) {
        console.error("Error uploading file:", error);
        throw error;
    }
}

async function getImageFileContent(imagePath) {
    try {
        const fileContent = await fs.readFile(imagePath); // This returns a Buffer
        return fileContent;
    } catch (error) {
        console.error("Error reading file:", error);
        throw error;
    }
}*/

// Import required modules
const { SQSClient, SendMessageCommand, DeleteMessageCommand } = require("@aws-sdk/client-sqs");
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { Consumer } = require('sqs-consumer');
const fs = require("fs").promises;
const path = require("path");
const util = require("util");
const execAsync = util.promisify(require("child_process").exec);

// Define constants
const image_folder_path = '/home/ec2-user/CSE546-Cloud-Computing-main/dataset/face_images_1000';
const face_recognition_model = '/home/ec2-user/CSE546-Cloud-Computing-main/model/face_recognition.py';
const REGION = "us-east-2";
const URL_RESPONSE_SQS = "https://sqs.us-east-2.amazonaws.com/992382822519/ResponseQueue-1";
const URL_REQUEST_SQS = "https://sqs.us-east-2.amazonaws.com/992382822519/RequestQueue-1"
const INPUT_BUCKET_NAME = "asuid-in-bucket";
const OUTPUT_BUCKET_NAME = "asu-id-out-bucket";

// Create SQS and S3 service objects
const sqsClient = new SQSClient({ region: REGION });
const s3Client = new S3Client({ region: REGION });

// Helper function to run Python script and return the output
const runPythonScript = async (filename) => {
    try {
        const imagePath = path.join(image_folder_path, filename);
        await fs.access(imagePath, fs.constants.F_OK);
        const { stdout, stderr } = await execAsync(`python3 "${face_recognition_model}" "${imagePath}"`, { maxBuffer: 1024 * 1024 });

        if (stderr) {
            console.error('Python script stderr:', stderr);
            throw new Error(stderr);
        }

        console.log('Python script executed successfully');
        return stdout.trim();
    } catch (error) {
        console.error("Error in runPythonScript:", error);
        throw error;
    }
};

// Helper function to upload file content to S3
const uploadFileToS3 = async (fileContent, bucketName, key) => {
    const uploadParams = {
        Bucket: bucketName,
        Key: key,
        Body: fileContent,
    };

    try {
        const data = await s3Client.send(new PutObjectCommand(uploadParams));
        console.log("File uploaded successfully. Location:", `https://${bucketName}.s3.amazonaws.com/${key}`);
        return data;
    } catch (error) {
        console.error("Error uploading file:", error);
        throw error;
    }
};

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

// Function to read image file content
async function getImageFileContent(imagePath) {
    try {
        return await fs.readFile(imagePath); // This returns a Buffer
    } catch (error) {
        console.error("Error reading file:", error);
        throw error;
    }
}

// Create an SQS Consumer
const consumer = Consumer.create({
    queueUrl: URL_REQUEST_SQS,
    handleMessage: async (message) => {
        console.log("Received message:", message.Body);
        const { filename, correlationId } = JSON.parse(message.Body);
        
        try {
            // Process the image file
            const imagePath = path.join(image_folder_path, filename);
            const fileContent = await getImageFileContent(imagePath);
            await uploadFileToS3(fileContent, INPUT_BUCKET_NAME, filename);
            console.log("Image uploaded to S3:", filename);

            const result = await runPythonScript(filename);
            console.log("Model output:", result);

            await uploadFileToS3(Buffer.from(result), OUTPUT_BUCKET_NAME, filename);
            console.log("Result uploaded to S3:", filename);

            // Send response back to SQS
            const responseMessage = {
                filename,
                result,
                correlationId,
            };
            await sendMessageToSQS(URL_RESPONSE_SQS, JSON.stringify(responseMessage));
        } catch (error) {
            console.error("Error processing message:", error);
        }
    },
    sqs: sqsClient,
});

consumer.on('error', (err) => {
    console.error('Error:', err.message);
});

consumer.on('processing_error', (err) => {
    console.error('Processing Error:', err.message);
});

// Start the consumer
consumer.start();

