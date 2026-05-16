module.exports = (options) => {
  return {
    ...options,
    externals: [
      ...(options.externals || []),
      // pdfmake needs to be externalized so Node.js resolves it at runtime.
      /^pdfmake\/.*/,
    ],
  };
};
