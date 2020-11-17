const log = require("loglevel"),
    request = require('request'),
    fs = require('fs'),
    { MongoClient } = require("mongodb"),
    config = require('config');

const mongodb_uri = config.mongodb.uri;
const dbclient = new MongoClient(mongodb_uri, { useUnifiedTopology: true });

const AMFI_FROM_TO_NAV_URL = 'http://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx?frmdt=###dd-mmm-yyyy###&todt=###dd-mmm-yyyy###';
const AMFI_CURRENT_NAV_URL = 'https://www.amfiindia.com/spages/NAVAll.txt';

class AmfiNAVParser {
    constructor({
        startDate,
        endDate,
        navURL,
        logLevel = 'warn'
    }) {
        this.logLevel = logLevel;
        log.setLevel(this.logLevel);

        /*
         * If navURL, start & end dates are NOT passed, nav will be downloaded from AMFI_CURRENT_NAV_URL
         * If start & end dates are passed withOUT navURL, nav will be downloaded from AMFI_FROM_TO_NAV_URL
         * If navURL is passed start & end date will be ignored and content in the specific URL will be parsed.
         *    - this option is mostly for testing purpose.
         */
        if (navURL) {
            log.debug( `${this.constructor.name} - Custom NAV URL passed. Start and End dates will be ignored` );
            this.setNavURL(navURL)
        } else if (startDate || endDate) {
            let dateArgs = {
                startDate: new Date(startDate),
                endDate: new Date(endDate)
            }
            for (let datePrefix of ['start', 'end']) {
                let dateStr = datePrefix+'Date';
                
                if (dateArgs[dateStr].toString() === 'Invalid Date') {
                    throw "Invalid start date" + dateArgs[dateStr];
                }
                this[dateStr] = dateArgs[dateStr];
                log.debug( `${this.constructor.name} - ${dateStr} set to : ${this[dateStr]}` );
            }
            this.setNavURL();
        } else {
            this.startDate = new Date();
            this.endDate = new Date();
            this.setNavURL(AMFI_CURRENT_NAV_URL);
        }
    }
    
    setNavURL (navURL) {
        if (navURL) {
            this.navURL = navURL;
        } else {
            let amfiDateStr = this._getAMFIFormattedDate(this.startDate);
            navURL = AMFI_FROM_TO_NAV_URL.replace('frmdt=###dd-mmm-yyyy###', 'frmdt='+amfiDateStr);

            amfiDateStr = this._getAMFIFormattedDate(this.endDate);
            navURL = navURL.replace('todt=###dd-mmm-yyyy###', 'todt='+amfiDateStr);
            this.navURL = navURL;
        }
        log.debug( `${this.constructor.name} - navURL set to : ${this.navURL}` );
    }

    _getAMFIFormattedDate(dateObject) {
        dateObject = dateObject || new Date();
        if (!dateObject instanceof Date
            || dateObject.toString() === 'Invalid Date') {

            throw "Not a valid Date: "+ dateObject;
        }

        let monthArray = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        let amfiDateStr = [dateObject.getDate()];
        amfiDateStr.push (monthArray[dateObject.getMonth()]);
        amfiDateStr.push (dateObject.getFullYear());

        return amfiDateStr.join('-');
    }

    async loadNavContent() {
        try {
            let navContent = await this._downloadPage(this.navURL);
            let parsedNavHash = this._parseAMFINAV(navContent);
            this.navContent = parsedNavHash;
            log.debug( `${this.constructor.name} - total nav rows parsed : ${this.navContent.length}` );

            this.upsertAmfiNavHistory()
        } catch (error) {
            console.error('ERROR:');
            console.error(error);
        }
    }

    _downloadPage() {
        let url = this.navURL;
        log.debug( `${this.constructor.name} - Downloading nav from URL : ${url}` );

        if (/^http.*/.test(url)) {
            return new Promise((resolve, reject) => {
                request(url, (error, response, body) => {
                    if (error) reject({error: error});
                    if (response.statusCode != 200) {
                        reject('Invalid status code <' + response.statusCode + '>');
                    }
                    resolve({content: body});
                });
            });
        } else if (/^file:/.test(url)) {
            url = url.replace('file:', '');
            return new Promise ((resolve, reject) => {
                fs.readFile(url, {encoding: 'utf-8'}, function(error, body){
                    if (error) reject({error: error});
                    resolve({content: body});
                });
            });
        }
    }

    _parseAMFINAV = function (navContent) {
        // TODO: validate navContent
        let navLines = navContent.content;
        navLines = navLines.replace(/\n \r/g, ''); // removing new lines

        //validate Header
        let navRangeFields = [
            'Scheme Code',
            'Scheme Name',
            'ISIN Div Payout\/ISIN Growth',
            'ISIN Div Reinvestment',
            'Net Asset Value',
            'Repurchase Price',
            'Sale Price',
            'Date'
        ];
        let navCurrentFields = [
            'Scheme Code',
            'ISIN Div Payout/ ISIN Growth',
            'ISIN Div Reinvestment',
            'Scheme Name',
            'Net Asset Value',
            'Date'
        ];

        let navRangeHeaderRegex = new RegExp('^\s*'+navRangeFields.join(';')+'.*');
        let navCurrentHeaderRegex = new RegExp('^\s*'+navCurrentFields.join(';')+'.*');
        let navContentType;
        if( navRangeHeaderRegex.test(navLines) ) {
            navContentType = 'date-range';
        } else if (navCurrentHeaderRegex.test(navLines)) {
            navContentType = 'current';
        } else {
            throw "Nav content is not parsable. URL: " + this.navURL;
        }
        navLines = navLines.replace(/^[^\r]*/,''); // removing header
        navLines = navLines.trim().split('\r\n');  // trim and split by lines
        let currentFundHouse = '';
        let currentFundScheme = '';
        let navHash = [];
        for (let i = 0; i <navLines.length; i++) {
            let navLine = navLines[i];
    
            // Get Fund Scheme
            if (navLine.match(/^(Open Ended|Close Ended|Interval Fund)/)) {
                currentFundScheme = navLine;
            }
            //Get NAV Details
            else if (navLine.match(/^\d+;/)){

                if (log.getLevel() === 0 
                    && (i%1000 == 0)) {

                    log.debug( `${this.constructor.name} - sample NAV line : ${navLine}` );
                }
                
                let [amfiCode, schemeName, ISIN, ISINReinv, nav, repurchasePrice, salePrice, date] = []
                if (navContentType == 'date-range') {
                    [amfiCode, schemeName, ISIN, ISINReinv, nav, repurchasePrice, salePrice, date] = navLine.split(';');
                } else if (navContentType == 'current') {
                    [amfiCode, ISIN, ISINReinv, schemeName, nav, date] = navLine.split(';');
                }
                navHash.push({
                    fundhouse: currentFundHouse,
                    fundscheme: currentFundScheme,
                    amfiCode: amfiCode,
                    schemename: schemeName,
                    isin: ISIN,
                    isinreinv: ISINReinv,
                    nav: nav,
                    repurchasePrice: repurchasePrice,
                    salePrice: salePrice,
                    date: new Date(date + ' 05:30:00') // IST Offset to make the GMT value to same date.
                });
            } 
            // get fund house names
            else {
                currentFundHouse = navLine.trim();
            }
        };
        return(navHash);
    }

    async upsertAmfiNavHistory() {
        try {
          await dbclient.connect();
          const database = dbclient.db(config.mongodb.mutualfundDB);
          const fundsnavhistory = database.collection("mutualfundnavs");
          const mutualfunds = database.collection("mutualfunds");
          let docModifiedStat = { updated: 0, inserted: 0 };
          for (let i = 0; i < this.navContent.length; i++) {
    
            let navDetail = this.navContent[i];
            // create a filter for a movie to update

            let r = await mutualfunds.findOneAndUpdate(
                { amfiCode: navDetail.amfiCode },
                { $set: {
                    amfiCode: navDetail.amfiCode,
                    fundhouse: navDetail.fundhouse,
                    fundscheme: navDetail.fundscheme,
                    schemename: navDetail.schemename,
                    isin: navDetail.isin,
                    isinreinv: navDetail.isinreinv
                }},
                {
                    projection: {
                        '_id': 1
                    },
                    returnNewDocument: true,
                    returnOriginal: false,
                    upsert: true
                }
            )

            let currentFundId = r.value._id;

            let filter = { mutualfundsid: currentFundId };
            let options = { upsert: true };
            let updateDoc = {
                $set: {
                    mutualfundsid: currentFundId,
                    nav: navDetail.nav,
                    repurchasePrice: navDetail.repurchasePrice,
                    salePrice: navDetail.salePrice,
                    date: navDetail.date // IST Offset to make the GMT value to same date.
                }
            };
            r = await fundsnavhistory.updateOne(filter, updateDoc, options);

            if (r.result.nModified) {
                docModifiedStat.updated += r.result.nModified;
            } else if (r.result.upserted) {
                docModifiedStat.inserted++;
            }
          }
          log.info(`NAVs Inserted ${docModifiedStat.inserted}; Updated: ${docModifiedStat.updated}`)
        } catch (err) {
            log.error("Error while update Database: "+ err);
        } finally {
          await dbclient.close();
        }
      }
}
module.exports = AmfiNAVParser;