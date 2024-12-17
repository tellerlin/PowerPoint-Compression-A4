module.exports = {
    // 禁止无用的文件依赖
    forbidden: [
      {
        name: 'no-unsolicited-imports',
        severity: 'warn',
        from: {},
        to: {
          pathNot: '^src/.*$', // 确保只关注 `src` 目录下的文件
        },
      },
    ],
    options: {
      // 输出为文本格式
      outputType: 'text',
      // 包含详细的模块依赖
      collapse: 1, // 仅显示模块之间的直接依赖
    },
  };