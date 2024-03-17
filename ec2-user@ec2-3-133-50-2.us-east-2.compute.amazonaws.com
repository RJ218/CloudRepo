const express = require('express');
const multer = require('multer');
const { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } = require("@aws-sdk/client-sqs");
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

// Set up the Express app and SQS client
const app = express();
const port = 8080;
const sqsClient = new SQSClient({ region: "us-east-2" });

// Constants for SQS URLs and bucket names
const URL_REQUEST_SQS = "https://sqs.us-east-2.amazonaws.com/992382822519/RequestQueue-1";
const URL_RESPONSE_SQS = "https://sqs.us-east-2.amazonaws.com/992382822519/ResponseQueue-1";

// Set up multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Start the server
app.post('/', upload.single('inputFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No image file uploaded!');
  }

  // Extract file information and send a message to the request queue
  const filename = req.file.originalname;
  const filePath = req.file.path;
  const correlationId = uuidv4();

  // Construct the message with the file details
  const sqsMessageBody = JSON.stringify({ filename, filePath, correlationId});

  try {
    // Send the message to the request queue and wait for the response
    const messageId = await sendMessageToSQS(URL_REQUEST_SQS, sqsMessageBody);
    const response = await pollForResponse(URL_RESPONSE_SQS, messageId);
    res.send(response);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error processing the request");
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

// Helper functions

async function sendMessageToSQS(queueUrl, messageBody) {
  const params = {
    QueueUrl: queueUrl,
    MessageBody: messageBody,
  };

  const data = await sqsClient.send(new SendMessageCommand(params));
  console.log("Message sent to SQS with MessageId:", data.MessageId);
  return data.MessageId; // Return the message ID to match with the response
}

async function pollForResponse(queueUrl, correlationId) {
  console.log(`Starting to poll for response with correlation ID: ${correlationId}`);
  
  while (true) {
    console.log(`Polling ${queueUrl} for response...`);
    
    const params = {
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20,
      MessageAttributeNames: ["All"], // Retrieve all message attributes
    };

    try {
      const data = await sqsClient.send(new ReceiveMessageCommand(params));
      
      //console.log(`Received data from SQS:`, data);

      if (data.Messages && data.Messages.length > 0) {
        const message = data.Messages[0];
        
        console.log(`Evaluating message:`, message);

        // Assuming the correlation ID is included in the body, not as a separate message attribute
        // Adjust this part based on your actual message structure
        const messageBody = JSON.parse(message.Body);
        console.log(`Parsed message body:`, messageBody);
		console.log(correlationId)
		console.log(messageBody.correlationId)
        if (messageBody && messageBody.correlationId === correlationId) {
          console.log("Matching response message received:", message.Body);
          await deleteMessageFromSQS(queueUrl, message.ReceiptHandle);
          return message.Body; // Return the response message body
        }
      } else {
        console.log("No messages received in this poll, continuing to poll...");
      }
    } catch (error) {
      console.error("Error while polling SQS:", error);
      throw error; // Rethrow or handle as needed
    }

    // Sleep before the next poll to avoid excessive requests
    console.log("Sleeping for 5 seconds before next poll...");
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

async function deleteMessageFromSQS(queueUrl, receiptHandle) {
  const params = {
    QueueUrl: queueUrl,
    ReceiptHandle: receiptHandle,
  };

  await sqsClient.send(new DeleteMessageCommand(params));
  console.log("Message deleted from SQS:", receiptHandle);
}
