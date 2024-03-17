import boto3
import subprocess
from flask import Flask, request, jsonify
import csv
from werkzeug.utils import secure_filename
import os

app = Flask(__name__)
UPLOAD_FOLDER = 'uploads'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

in_bucket = "asuid-in-bucket"
out_bucket = "asu-id-out-bucket"
s3 = boto3.client('s3')

# # Load predictions from CSV file
# def load_predictions():
#     try:
#         with open('dataset.csv', mode='r') as csv_file:
#             csv_reader = csv.DictReader(csv_file)
#             for row in csv_reader:
#                 predictions[row['Image']] = row['Results']
#     except Exception as e:
#         print(f"Error reading prediction file: {e}")
#         exit(1)
#
# load_predictions()

@app.route('/', methods=['POST'])
def upload_file():
    if 'inputFile' not in request.files:
        return 'No image file uploaded!', 400
    file = request.files['inputFile']
    if file.filename == '':
        return 'No image file uploaded!', 400

    filename = secure_filename(file.filename).split('.')[0]
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(file_path)

    addToS3(filename, )

    if filename not in predictions:
        return 'Image not found in dataset!', 404

    # Return the prediction from the lookup table
    prediction = predictions[filename]
    return jsonify({filename: prediction})


result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
if result.returncode == 0:
    print("Command executed successfully!")
    print("Output:\n", result.stdout)
else:
    print("Command failed.")
    print("Error:\n", result.stderr)

def addToS3(key, value, s3Name):
    # Specify the file to upload
    filename = 'file.txt'
    bucket_name = 'your-bucket-name'
    # Upload the file
    s3.upload_file(filename, bucket_name, filename)

if __name__ == '__main__':
    if not os.path.exists(UPLOAD_FOLDER):
        os.makedirs(UPLOAD_FOLDER)
    app.run(port=8080)


