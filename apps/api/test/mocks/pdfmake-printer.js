// Mock pdfmake printer for tests — pdfmake ships ESM which Jest can't load
const { PassThrough } = require('stream');

class PdfPrinter {
  createPdfKitDocument() {
    const doc = new PassThrough();

    // pdfmake's real API: callers attach data/end listeners then call doc.end().
    // We override end() to write mock PDF data then close the stream.
    const originalEnd = doc.end.bind(doc);
    doc.end = function () {
      doc.write(Buffer.from('%PDF-1.4 mock'));
      originalEnd();
    };

    // Support pipe pattern used by some callers
    const originalPipe = doc.pipe.bind(doc);
    doc.pipe = function (writable) {
      return originalPipe(writable);
    };

    return doc;
  }
}

module.exports = PdfPrinter;
