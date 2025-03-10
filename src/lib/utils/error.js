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

export const ErrorMessages = {
  [ErrorTypes.FILE_SIZE]: "File size exceeds the maximum limit of 300MB",
  [ErrorTypes.FILE_TYPE]: "Unsupported file type. Please upload a PPTX file",
  [ErrorTypes.NETWORK]: "Network connection failed. Please check your connection",
  [ErrorTypes.PROCESSING]: "Failed to process the file. Please try again",
  [ErrorTypes.UNKNOWN]: "An unexpected error occurred. Please try again"
};