let CamsPDFParser = require ('./CamsPDFParser.js');

let pdfParser;

pdfParser = new CamsPDFParser({
    filePath: './samplereport/cams-consolidate-report.pdf',
    password: 'password',
    logLevel: 'info',
    suppressNoTxnFolio: true
});