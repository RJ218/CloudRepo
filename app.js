/*const express = require('express');
const multer = require('multer');
const { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } = require("@aws-sdk/client-sqs");
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const { Consumer } = require('sqs-consumer');


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
    const response = await pollForResponse(URL_RESPONSE_SQS, correlationId);
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

/*async function pollForResponse(queueUrl, correlationId) {
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
        
        //console.log(`Evaluating message:`, message);

        // Assuming the correlation ID is included in the body, not as a separate message attribute
        // Adjust this part based on your actual message structure
        const messageBody = JSON.parse(message.Body);
        //console.log(`Parsed message body:`, messageBody);
		//console.log(correlationId)
		//console.log(messageBody.correlationId)
        if (messageBody && messageBody.correlationId === correlationId) {
          console.log("Matching response message received:", message.Body);
          await deleteMessageFromSQS(queueUrl, message.ReceiptHandle);
		  
		  const responseBody = JSON.parse(message.Body);
	      const resultData = responseBody.result;
          return resultData; // Return the response message body
        }
      } else {
        console.log("No messages received in this poll, continuing to poll...");
      }
    } catch (error) {
      console.error("Error while polling SQS:", error);
      throw error; // Rethrow or handle as needed
    }

    // Sleep before the next poll to avoid excessive requests
    console.log("Sleeping for 500 ms before next poll...");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}*/

/*async function pollForResponse(queueUrl, correlationId) {
  console.log(`Starting to poll for response with correlation ID: ${correlationId}`);
  
  let backoffTime = 50; // Start with a 500 ms backoff time
  const maxBackoffTime = 200; // Set a max backoff time, for example, 2 seconds

  while (true) {
    const params = {
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20,
      MessageAttributeNames: ["All"],
    };

    try {
      const data = await sqsClient.send(new ReceiveMessageCommand(params));

      if (data.Messages && data.Messages.length > 0) {
        const message = data.Messages[0];
        const messageBody = JSON.parse(message.Body);
        
        if (messageBody && messageBody.correlationId === correlationId) {
          console.log("Matching response message received:", message.Body);
          await deleteMessageFromSQS(queueUrl, message.ReceiptHandle);
		  
		  const resultData = messageBody.result; // Assuming 'result' is the key you need
          return resultData;
        }
      } else {
        console.log("No messages received, increasing backoff time...");
        backoffTime = Math.min(maxBackoffTime, backoffTime * 2);
      }
    } catch (error) {
      console.error("Error while polling SQS:", error);
      backoffTime = Math.min(maxBackoffTime, backoffTime * 2); // Increase backoff time on error
    }

    console.log(`Sleeping for ${backoffTime} ms before next poll...`);
    await new Promise(resolve => setTimeout(resolve, backoffTime));
  }
}


// Function to handle messages received from the response queue
const handleMessage = async (message) => {
  console.log("Received message:", message.Body);
  const messageBody = JSON.parse(message.Body);
  
  if (messageBody.correlationId) {
    // Process message based on correlationId and return the result
    // For example, you can resolve a promise that's waiting for this message
  }

  // Delete message from the queue after processing
  await deleteMessageFromSQS(URL_RESPONSE_SQS, message.ReceiptHandle);
};

// Create a consumer for the response SQS queue
const responseConsumer = Consumer.create({
  queueUrl: URL_RESPONSE_SQS,
  handleMessage,
  sqs: new SQSClient({ region: "us-east-2" }),
  batchSize: 1, // Process one message at a time
  visibilityTimeout: 30, // Adjust if your processing time may exceed this value
});

// Start the consumer
responseConsumer.start();

// Stop the consumer when you're ready to stop polling
// responseConsumer.stop();


async function deleteMessageFromSQS(queueUrl, receiptHandle) {
  const params = {
    QueueUrl: queueUrl,
    ReceiptHandle: receiptHandle,
  };

  await sqsClient.send(new DeleteMessageCommand(params));
  console.log("Message deleted from SQS:", receiptHandle);
}*/

const express = require('express');
const multer = require('multer');
const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");
const { Consumer } = require('sqs-consumer');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ dest: 'uploads/' });
const sqsClient = new SQSClient({ region: "us-east-2" });
const port = 8080;

const URL_REQUEST_SQS = "https://sqs.us-east-2.amazonaws.com/992382822519/RequestQueue-1";
const URL_RESPONSE_SQS = "https://sqs.us-east-2.amazonaws.com/992382822519/ResponseQueue-1";

// Map to keep track of pending responses
const pendingResponses = new Map();

app.post('/', upload.single('inputFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No image file uploaded!');
  }

  const correlationId = uuidv4();
  const sqsMessageBody = JSON.stringify({
    filename: req.file.originalname,
    filePath: req.file.path,
    correlationId,
  });

  // Send the message to the request queue
  await sendMessageToSQS(URL_REQUEST_SQS, sqsMessageBody);

  // Store the HTTP response object to resolve later
  pendingResponses.set(correlationId, res);
});

const responseConsumer = Consumer.create({
  queueUrl: URL_RESPONSE_SQS,
  handleMessage: async (message) => {
    const { correlationId, result } = JSON.parse(message.Body);

    if (pendingResponses.has(correlationId)) {
      const res = pendingResponses.get(correlationId);
      res.send({ result });
      pendingResponses.delete(correlationId);
    }
  },
  sqs: sqsClient,
});

responseConsumer.on('error', (err) => {
  console.error(err.message);
});

responseConsumer.start();

async function sendMessageToSQS(queueUrl, messageBody) {
  const params = {
    QueueUrl: queueUrl,
    MessageBody: messageBody,
  };

  const data = await sqsClient.send(new SendMessageCommand(params));
  console.log("Message sent to SQS with MessageId:", data.MessageId);
}

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

