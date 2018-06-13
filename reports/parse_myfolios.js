let CamsPDFParser = require ('../CamsPDFParser.js');

let pdfParser;

pdfParser = new CamsPDFParser({
    filePath: './preethashankar83-till-2016-03-31.pdf',
    password: 'AGOPJ2416K',
    logLevel: 'info',
    suppressNoTxnFolio: true
});

pdfParser = new CamsPDFParser({
    filePath: './malliga82-till-2016-03-31.pdf',
    password: 'AGOPJ2416K',
    logLevel: 'info',
    suppressNoTxnFolio: true
});
