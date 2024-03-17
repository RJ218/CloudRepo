from flask import Flask, request, jsonify
import os
import random

app = Flask(__name__)

@app.route('/', methods=['POST'])
def handle_request():
    uploaded_file = request.files['inputFile']
    if uploaded_file:
        # Simulate processing the file (e.g., randomly decide if the prediction is correct or wrong)
        # In a real scenario, you would replace this with actual file processing logic
        result = random.choice(['Correct', 'Wrong'])
        response_message = f'Prediction: {result}'

        # Optionally, save the file to a directory (make sure the directory exists)
        # uploaded_file.save(os.path.join('received_files', uploaded_file.filename))

        return jsonify({"message": response_message}), 200
    else:
        return jsonify({"error": "No file uploaded"}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000, debug=True)
