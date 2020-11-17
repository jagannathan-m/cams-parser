const fs = require('fs'),
    PDFParser = require("pdf2json/PDFParser"),
    log = require("loglevel"),
    MongoClient = require('mongodb').MongoClient,
    co = require('co'),
    assert = require('assert'),
    config = require('config');

    const mongodb_uri = config.mongodb.uri;
const dbclient = new MongoClient(mongodb_uri, { useUnifiedTopology: true });

class CamsPDFParser extends PDFParser {
    constructor({
        filePath,
        password,
        logLevel = 'warn',
        suppressNoTxnFolio = false
    }) {
        super();

        log.setLevel(logLevel);
        this.filePath = filePath;
        this.password = password;
        this.suppressNoTxnFolio = suppressNoTxnFolio;

        this._setFundHouses();
        this.supportedVersions = new Set([
            'V3.4'
        ]);
        this.report = {
            'folios': {}
        };

        this.on("pdfParser_dataError", errData => console.error(errData.parserError));
        this.on("pdfParser_dataReady", pdfData => {
            log.info(`Processing file : ${this.filePath}`);
            this.postProcess(pdfData);
        });

        this.loadPDF(this.filePath, 0, this.password);
    }

    // pdf2json post process
    postProcess(pdfData) {
        if (!this.isSupportedVersion(pdfData)) {
            log.error('Statement version \'' + this.report.version + '\' is not supported by the parser!');
            return;
        }

        let pdfParsedLines = this.parseTextLine(pdfData);

        this._setNonFolioData(pdfParsedLines);
        let pdfFolioBlocks = this.parseFolioBlocks(pdfParsedLines);

        if (log.getLevel() <= log.levels.DEBUG) {
            let totalTransactionsCount = 0,
                totalValuation = 0;

            let pans = Object.keys(this.report.folios);

            pans.forEach(pan => {
                let folios = Object.keys(this.report.folios[pan]);
                folios.forEach(folio => {
                    let funds = Object.keys(this.report.folios[pan][folio]);
                    funds.forEach(fund => {
                        let closingBalance = 0,
                            reportValue = 0;

                        let fundHash = this.report.folios[pan][folio][fund];
                        console.log(`${fundHash.fundhouse} \nFolio No: ${folio} \t PAN: ${pan}`);
                        console.log(`${fund}-${fundHash.fundname} (Advisor: ${fundHash.advisor}) \t Registrar: ${fundHash.registrar}`);
                        fundHash.transaction.forEach(txn => {
                            console.log(`${txn.date}  ${txn.transaction}  ${txn.amount} \t ${txn.units} \t ${txn.price} \t ${txn.unitBalance}`);
                            closingBalance += parseFloat(txn.units);
                        });
                        console.log(`Closing Balance: ${closingBalance.toFixed(3)} \t NAV on ${this.report.period.enddate}: INR ${fundHash.nav}`);

                        totalTransactionsCount += fundHash.transaction.length;
                        totalValuation += parseFloat(fundHash.reportvalue)
                        console.log('--'.repeat(20));
                    });
                });
            });
            log.debug('Total number of transactions parsed :' + totalTransactionsCount);
            log.debug(`Total value as of ${this.report.period.enddate} is ${totalValuation}`);
            console.log('=='.repeat(20));
        }
        // console.log(JSON.stringify(this.report, undefined, 2));
        this.updateDB();
    }

    // parse the json returned by parseTextLine
    // returns array of line texts 
    parseTextLine(pdfData) {
        let pdfParsedText = {};
        let offsetHeight = 0; // to specify top of first page.

        // get all text pdfData.fromImage.Pages[*].Texts[*].R[*].T
        for (let i in pdfData.formImage.Pages) {
            let page = pdfData.formImage.Pages[i];
            page.Texts.forEach(text => {
                let {
                    x,
                    y,
                    R
                } = text;
                y += offsetHeight;
                let textBlock = '';
                text.R.forEach(r => {
                    textBlock += decodeURI(r.T);
                });
                if (!pdfParsedText[y]) {
                    pdfParsedText[y] = {};
                }
                pdfParsedText[y][x] = textBlock;
            });
            // Adding current pages height to offset height for next page
            offsetHeight += page.Height;
        };
        log.info("Total number of parsed lines: " + Object.keys(pdfParsedText).length);

        return this._mergeSameLineTexts(pdfParsedText);
    }

    parseFolioBlocks(pdfParsedLines) {
        // Extract Folio details
        let folioBlocks = this._extractFolioLines(pdfParsedLines)
        let extracter = {
            OpeningBalance: /Opening Unit Balance: ([\d.]*)/,
        };
        // console.log(folioBlocks);
        for (let i in folioBlocks) {
        // for(let i=0; i < 3; i++) {
            let block = folioBlocks[i];
            // remove margin note
            for (let i in block) {
                if (block[i].match(this.marginNote)) {
                    block[i] = block[i].replace(this.marginNote + '#', '');
                }
            }

            let fundHouse = block[0];
            let {
                panNum,
                folioNum
            } = this._extractFolioPan(block[1]);
            let {
                rawFundName,
                fundCode,
                fundName,
                advisor,
                registrar
            } = this._extractFundInfo(fundHouse, block[2], block[3]);
            let openingBalance = (block[3] + block[4]).match(extracter.OpeningBalance);
            if (openingBalance) {
                openingBalance = openingBalance[1].replace(',', '');
            }

            let {
                closingBalance,
                nav,
                reportValue
            } = this._extractClosingBalanceNAV(block[block.length - 1]);

            let txnArray = [];
            for (let i = 4; i < block.length - 1; i++) {
                let txn = this._parseTransactionLine(block[i]);
                if (!txn) {
                    continue;
                }
                if ((parseFloat(txn.unitBalance) - parseFloat(openingBalance) - parseFloat(txn.units)).toFixed() != 0) {
                    log.warn('Unable to balance the transaction line <' + txn.txnline + '> for fund "' + rawFundName + '"')
                }

                txnArray.push(txn);
                if (txn.units) {
                    openingBalance = parseFloat(openingBalance) + parseFloat(txn.units);
                }
            }

            if (this.suppressNoTxnFolio === true && txnArray.length === 0) {
                continue;
            }
            if ((parseFloat(openingBalance) - parseFloat(closingBalance)).toFixed() != 0) {
                log.warn('Could not reconcile closing balance. Some parse some transaction for the fund "' + rawFundName + '"');
            }

            let fundHash = {
                'fundhouse': fundHouse,
                'rawfundname': rawFundName,
                'fundname': fundName,
                'registrar': registrar,
                'advisor': advisor,
                'nav': nav,
                'reportvalue': reportValue,
                'transaction': txnArray
            };

            this._setReportFolio({
                panNum: panNum,
                folioNum: folioNum,
                fundCode: fundCode,
                fundHash: fundHash
            });
        };
    }

    // check whether the statement version is currently supported
    isSupportedVersion(pdfData) {
        let version = unescape(decodeURI(pdfData.formImage.Pages[0].Texts[0].R[0].T));
        this.marginNote = version;
        version = version.match(/Version:(\w+\.\w+) Live/);
        if (version) {
            this.version = version[1];
            this.report.version = version[1];
        }
        return (this.supportedVersions.has(this.report.version)) ? true : false;
    }

    // extract non folio detail
    _setNonFolioData(pdfParsedLines) {
        let periodExtractor = /(\d+-\w+-\d+) To (\d+-\w+-\d+)#/;

        let period = pdfParsedLines[0].match(periodExtractor);
        if (period) {
            this.report.period = {
                startdate: period[1],
                enddate: period[2]
            }
        }

        let emailExtractor = /^Email Id: ([^#]*)/;
        let email = unescape(pdfParsedLines[1]).match(emailExtractor);
        if (email) {
            this.report['email'] = email[1];
        }
    }

    // loads the fundhouse_list.json
    _setFundHouses() {
        let fundHouses = require('./fundhouse_list.json');
        this.fundHouses = new Set(fundHouses);
    }

    // merge same line texts
    // returns array with line texts 
    _mergeSameLineTexts(pdfParsedText) {
        let sortedY = Object.keys(pdfParsedText).sort(this.numsort);
        let currentY = sortedY[0];

        // Identity same line texts
        // removing minor vaiance in y and merging them.
        for (let i = 0; i < sortedY.length; i++) {
            let y = sortedY[i];
            if (this._isSameLine(currentY, y)) {
                Object.assign(pdfParsedText[currentY], pdfParsedText[y]);
                delete pdfParsedText[y];
                sortedY.splice(i, 1);
                i--; // decrementing the index as an element was spliced
            } else {
                currentY = y;
            }
        }

        // concatenating same line texts
        let pdfParsedLines = [];
        sortedY.forEach(y => {
            let sortedX = Object.keys(pdfParsedText[y]).sort(this.numsort);
            let line = '';
            sortedX.forEach(x => {
                line += pdfParsedText[y][x] + '#';
            });
            pdfParsedLines.push(line);
        });
        log.info("Number of lines after removing minor variances: " + Object.keys(pdfParsedLines).length);
        return pdfParsedLines;
    }

    _extractFolioLines(pdfParsedLines) {
        let folioBlocks = [],
            currentFolio = [],
            pushFlag = 'NotInFolio',
            currentFundHouse = '';

        let blockStart = /^Folio No/,
            blockEnd = /^Closing Unit Balance/,
            pageBreakStart = /^Page \d+ of \d+/,
            pageBreakEnd = /^\(INR\)#\(INR\)#Balance/,
            fundHouseRegex = /(.*(Mutual Fund)\s*(\(idf\))*)#$/i;

        for (let i in pdfParsedLines) {
            let line = unescape(pdfParsedLines[i]);
            if (pushFlag === 'NotInFolio') {
                if (line.match(blockStart)) {
                    pushFlag = 'InFolio';
                    let fundHouse = pdfParsedLines[i - 1].match(fundHouseRegex);
                    if (fundHouse) {
                        currentFundHouse = fundHouse[1];
                    } else if (pdfParsedLines[i - 1].match(pageBreakEnd)) {
                        let pageBreak = 1,
                            j = 1;
                        while (pageBreak) {
                            j++;
                            if (pdfParsedLines[i - j].match(pageBreakStart)) {
                                j++
                                fundHouse = pdfParsedLines[i - j].match(fundHouseRegex);
                                if (fundHouse) {
                                    currentFundHouse = unescape(fundHouse[1]);
                                }
                                pageBreak = 0;
                            }
                        }
                    }
                    currentFolio.push(currentFundHouse, line);
                }
            } else if (pushFlag === 'InFolio') {
                if (line.startsWith(this.marginNote)) {
                    continue;
                }
                if (line.match(pageBreakStart)) {
                    pushFlag = 'InFolioPageBreak';
                    continue;
                }
                currentFolio.push(line);
                if (line.match(blockEnd)) {
                    folioBlocks.push(currentFolio);
                    currentFolio = [];
                    pushFlag = 'NotInFolio';
                }
            } else if (pushFlag === 'InFolioPageBreak') {
                if (line.match(pageBreakEnd)) {
                    pushFlag = 'InFolio';
                }
            }
        }

        log.info('Total Folio blocks parsed: ' + folioBlocks.length);
        return folioBlocks;
    }

    // parse transation line
    _parseTransactionLine(transaction) {
        let extracter = {
            TxnDate: /^(\d+)-(\w+)-(\d+)#/,
            TxnNumbers: /#([(\d]+\.[\d)]+)#([(\d]+\.[\d)]+)#(\d+\.\d+)#([(\d]+\.[\d)]+)#$/,
            NoTxnText: /^\s*\*\*\*([^*]*)/
        };

        // extract and remove transaction date
        let txnDate = transaction.match(extracter.TxnDate);
        let source, date, month, year;
        if (txnDate) {
            [source, date, month, year] = txnDate;
        } else {
            // TODO: Not a transaction line. need to be appended with previous line.
            return;
        }
        let txnLine = transaction.replace(extracter.TxnDate, '');

        let nonTxtText = txnLine.match(extracter.NoTxnText)
        if (nonTxtText) {
            return;
        }
        
        // removing comma charecters in figures
        txnLine = txnLine.replace(/(\d),(\d)/g, "$1$2")

        let parsedTxnLine = txnLine.replace(/#/g, ' ');
        
        let txnNumbers = txnLine.match(extracter.TxnNumbers);
        let amount, units, price, unitBalance;
        if (txnNumbers) {
            [source, amount, units, price, unitBalance] = txnNumbers;

            // parsing -ve values
            amount = amount.replace('(','-').replace (')','')
            units = units.replace('(','-').replace (')','')
            unitBalance = unitBalance.replace('(','-').replace (')','')
        }
        
        txnLine = txnLine.replace(extracter.TxnNumbers, '');
        txnLine = txnLine.replace(/#/g, '');

        return {
            txnline: parsedTxnLine,
            date: [date, month, year].join('-'),
            transaction: txnLine,
            amount: amount,
            units: units,
            price: price,
            unitBalance: unitBalance
        };
    }

    _extractFolioPan(folioLine) {
        let extracter = {
            Folio: /^Folio No: (\d+)/,
            PAN: /#PAN: (\w+)#/
        };

        let panNum = folioLine.match(extracter.PAN);
        if (panNum) {
            panNum = panNum[1];
        } else {
            panNum = 'NONE';
        }

        let folioNum = folioLine.match(extracter.Folio);
        if (folioNum) {
            folioNum = folioNum[1];
        }

        return {
            panNum: panNum,
            folioNum: folioNum
        };

    }

    _extractFundInfo(fundHouse = '', fundLine1, fundLine2) {
        let extracter = {
            Fund: /^(([^-]*)-(.*))/,
            OpeningBalance: 'Opening Unit Balance:',
            Registrar: /(.*)Registrar :\s*(\w*)#/,
            Advisor: /\(Advisor:[\s#]*([^()]*)\)*#/
        };

        // extract Registrar info from fundline
        let registrarInfo = fundLine1.match(extracter.Registrar);
        let source, fundLine, registrar;
        if (registrarInfo) {
            [source, fundLine, registrar] = registrarInfo
        }
        fundLine1 = fundLine1.replace(extracter.Registrar, '');

        // if fundLine2 dont have "Opening Unit Balance", then it should be considered as Fundline
        if (fundLine2.indexOf(extracter.OpeningBalance) === -1) {
            fundLine += fundLine2;
        }

        // extract Advisor info from fundline
        let advisorInfo = fundLine.match(extracter.Advisor);
        let advisor;
        if (advisorInfo) {
            [source, advisor] = registrarInfo
        }
        fundLine = fundLine.replace(extracter.Advisor, '');


        let fundInfo = fundLine.match(extracter.Fund);
        let rawFundName, fundCode, fundName;
        if (fundInfo) {
            [source, rawFundName, fundCode, fundName] = fundInfo;
        }

        let [fundHouseFirstWord] = fundHouse.split(' ');

        // removing if any fundhouse specific codes in fundName
        let re = new RegExp(fundHouseFirstWord + ".*", 'gi');
        if(!fundName) {
            log.info('----')
        }
        let tmp = fundName.match(re);
        if (tmp) {
            fundName = tmp[0].trim();
        }

        return {
            rawFundName: rawFundName,
            fundCode: fundCode,
            fundName: fundName,
            advisor: advisor,
            registrar: registrar
        };
    }

    _extractClosingBalanceNAV(folioLine) {
        let extracter = {
            ClosingBalance: /Closing Unit Balance: ([^#]*)#/,
            NAV: /#NAV on [^\s]* INR ([^#]*)#/,
            ReportValue: /Valuation on [^\s]* INR ([^#]*)#/
        };

        let closingBalance = folioLine.match(extracter.ClosingBalance);
        if (closingBalance) {
            closingBalance = closingBalance[1].replace(',', '');;
        }

        let reportValue = folioLine.match(extracter.ReportValue);
        if (reportValue) {
            reportValue = reportValue[1].replace(',', '');;
        }

        let nav = folioLine.match(extracter.NAV);
        if (nav) {
            nav = nav[1].trim();
        }

        return {
            closingBalance: closingBalance,
            reportValue: reportValue,
            nav: nav
        }
    }

    _setReportFolio(folioHash) {
        let {
            panNum,
            folioNum,
            fundCode,
            fundHash
        } = folioHash;

        if (!this.report.folios[panNum]) {
            this.report.folios[panNum] = {};
        }
        let panHash = this.report.folios[panNum];
        if (!panHash[folioNum]) {
            panHash[folioNum] = {};
        }

        if (panHash[folioNum][fundCode]) {
            let fundB = panHash[folioNum][fundCode];
            if (this.isSameFund(fundHash, fundB)) {
                fundB.transaction = fundB.transaction.concat(fundHash.transaction);
            } else {
                log.error('Unmatchable funds with same fund code :"' + fundHash.rawFundName + '" vs "' + fundB.rawFundName + '"');
            }
        } else {
            panHash[folioNum][fundCode] = fundHash;
        }
    }

    isSameFund(fundA, fundB) {
        if (
            fundA.fundName === fundB.fundName &&
            fundA.registrar === fundB.registrar &&
            fundA.advisor === fundB.advisor &&
            fundA.nav === fundB.nav
        ) {
            return true;
        } else {
            return false;
        }
    }

    numsort(a, b) {
        return a - b;
    }

    _isSameLine(y1, y2) {
        let deltaY = 0.2;

        if (Math.abs(y1 - y2) < deltaY) {
            return true;
        }
        return false;
    }

    updateDB() {
        let report = this.report;
        co(function*() {
            // Connection URL
            yield dbclient.connect();
            //console.log("Connected correctly to server");

            const database = dbclient.db(config.mongodb.mutualfundDB);
            const holdings = database.collection('holdings');
            const transactions = database.collection('transactions');

            let pans = Object.keys(report.folios);
            for (let i = 0; i < pans.length; i++) {
                let pan = pans[i];
                let folioNums = Object.keys(report.folios[pan]);

                //folioNums.forEach(folioNum => {
                for (let i = 0; i < folioNums.length; i++) {
                    let folioNum = folioNums[i];
                    let fundCodes = Object.keys(report.folios[pan][folioNum]);

                    // fundCodes.forEach(fundCode => {
                    for (let i = 0; i < fundCodes.length; i++) {
                        let fundCode = fundCodes[i];
                        let update = report.folios[pan][folioNum][fundCode];
                        let filter = {
                            email: report.email,
                            pan: pan,
                            folionumber: folioNum,
                            fundcode: fundCode,
                            fundname: update.fundname
                        };

                        // Insert a fund Info to holdingfunds
                        let r = yield holdings.findOneAndUpdate(
                            filter,
                            { 
                                $set: Object.assign(filter, {
                                    fundhouse: update.fundhouse,
                                    rawfundname: update.rawfundname,
                                    registrar: update.registrar,
                                    advisor: update.advisor
                                })
                            }, {
                                projection: {
                                    '_id': 1
                                },
                                returnNewDocument: true,
                                returnOriginal: false,
                                upsert: true
                            }
                        );

                        let currentHoldingId = r.value._id;
                        let txns = update.transaction;
                        let docModifiedStat = {
                            updated: 0,
                            inserted: 0
                        };
                        for (let i = 0; i < txns.length; i++) {
                            let txn = txns[i];
                            
                            // update transactions
                            let r = yield transactions.updateOne({
                                date: new Date(txn.date),
                                amount: parseFloat(txn.amount),
                                unitbalance: parseFloat(txn.unitBalance),
                                transaction: txn.transaction
                            }, {
                                $set: {
                                    date: txn.date,
                                    amount: parseFloat(txn.amount),
                                    unitbalance: parseFloat(txn.unitBalance),
                                    txnline: txn.txnline,
                                    date: new Date(txn.date),
                                    transaction: txn.transaction,
                                    units: parseFloat(txn.units),
                                    price: parseFloat(txn.price),
                                    holdingsid: currentHoldingId
                                }
                            }, {
                                upsert: true
                            });
                            //console.log(r.result);
                            if (r.result.nModified) {
                                docModifiedStat.updated += r.result.nModified;
                            } else if (r.result.upserted) {
                                docModifiedStat.inserted++;
                            }
                            
                        }
                        log.info(`Transaction Inserted ${docModifiedStat.inserted}; Updated: ${docModifiedStat.updated} : ${report.email}-${pan}-${fundCode}-${update.fundname}`)
                    };
                };
            };
            dbclient.close();
        }).catch(function(err) {
            dbclient.close();
            console.log(err.stack);
        });
    }
}

module.exports = CamsPDFParser;