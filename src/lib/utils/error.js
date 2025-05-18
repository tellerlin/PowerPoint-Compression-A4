export const ErrorTypes = {
  FILE_SIZE: "FILE_SIZE",
  FILE_TYPE: "FILE_TYPE",
  NETWORK: "NETWORK",
  PROCESSING: "PROCESSING",
  UNKNOWN: "UNKNOWN"
};

export class AppError extends Error {
  constructor(type, message) {
    super(message);
    this.type = type;
  }
}