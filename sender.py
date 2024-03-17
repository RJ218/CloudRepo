import socket


def send_file(filename, server_ip, server_port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.connect((server_ip, server_port))

        # Read file contents
        with open(filename, 'r') as file:
            file_data = file.read()

        # Send file contents
        s.sendall(file_data.encode('utf-8'))

        # Receive and print the response from the server
        result = s.recv(1024).decode('utf-8')
        print(f"Server response: {result}")


def main():
    server_ip = '127.0.0.1'  # Server IP address
    server_port = 12345  # Server port number
    filename = 'input.txt'  # File to send

    send_file(filename, server_ip, server_port)


if __name__ == "__main__":
    main()
