module.exports = {
    // Prohibit unused file dependencies
    forbidden: [
      {
        name: 'no-unsolicited-imports',
        severity: 'warn',
        from: {},
        to: {
          pathNot: '^src/.*$', // Ensure only focusing on files in the `src` directory
        },
      },
    ],
    options: {
      // Output as text format
      outputType: 'text',
      // Include detailed module dependencies
      collapse: 1, // Only show direct dependencies between modules
    },
  };