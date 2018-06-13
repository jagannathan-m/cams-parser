let CamsPDFParser = require ('./CamsPDFParser.js');

let pdfParser;

pdfParser = new CamsPDFParser({
    filePath: './samplereports/nathansmj.pdf',
    password: 'AGOPJ2416K',
    logLevel: 'info',
    suppressNoTxnFolio: true
});
pdfParser = new CamsPDFParser({
    filePath: './samplereports/preethashankar83.pdf',
    password: 'AGOPJ2416K',
    logLevel: 'info',
    suppressNoTxnFolio: true
});
pdfParser = new CamsPDFParser({
    filePath: './samplereports/malliga82.pdf',
    password: 'AGOPJ2416K',
    logLevel: 'info',
    suppressNoTxnFolio: true
});
/*
pdfParser = new CamsPDFParser({
    filePath: './samplereports/4.pdf',
    // password: 'AGOPJ2416K',
    logLevel: 'info',
    suppressNoTxnFolio: true
});

pdfParser = new CamsPDFParser({
    filePath: './samplereports/5.pdf',
    // password: 'AGOPJ2416K',
    logLevel: 'info',
    suppressNoTxnFolio: true
});
pdfParser = new CamsPDFParser({
    filePath: './samplereports/6.pdf',
    password: 'AGOPJ2416K',
    logLevel: 'info',
    suppressNoTxnFolio: true
});
pdfParser = new CamsPDFParser({
    filePath: './samplereports/7.pdf',
    password: 'AGOPJ2416K',
    logLevel: 'info',
    suppressNoTxnFolio: true
});
pdfParser = new CamsPDFParser({
    filePath: './samplereports/8.pdf',
    password: 'AGOPJ2416K',
    logLevel: 'info',
    suppressNoTxnFolio: true
});
*/
