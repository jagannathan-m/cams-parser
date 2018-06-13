let fs = require('fs'),
    MongoClient = require('mongodb').MongoClient,
    assert = require('assert');

// 'http://portal.amfiindia.com/spages/NAV0.txt'
let navLines = fs.readFileSync('./NAV.txt', 'utf8');
let navHash = [];
navLines = navLines.replace(/\n \r/g, ''); // removing new lines
navLines = navLines.replace(/^[^\r]*/,''); // removing header

navLines = navLines.trim().split('\r\n'); // removing unnessecary white lines
let currentFundHouse = '';
	
for (let i = 0; i <navLines.length; i++) {
	let navLine = navLines[i];
	if (navLine.match(/^(Open Ended|Close Ended|Interval Fund)/)) {
		continue;
	}
	else if (navLine.match(/^\d+;/)){
		let [schemeCode, ISIN, ISINReinv, schemeName,nav,repurcasePrice,salePrice,date] = navLine.split(';');
		navHash.push({
			fundhouse: currentFundHouse,
			schemecode: schemeCode,
			schemename: schemeName,
			isin: ISIN,
			isinreinv: ISINReinv,
			nav: nav,
			repurchaseprice: repurcasePrice,
			saleprice: salePrice,
			date: new Date(date)
		});
	} else {
		currentFundHouse = navLine.trim().toLowerCase();
	}
};
console.log(navHash.length);

MongoClient.connect('mongodb://localhost:27017/test', (err, db) => {
    assert.equal(null, err);
    var col = db.collection('amfinav');
	console.log(navHash.length);
	col.insert(navHash); // move it update***
	// db.close();
		
});
