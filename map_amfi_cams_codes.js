var amfiMap = require('./map_amfi_cams_codes.json');

let mongo = require('mongodb'),
	MongoClient = mongo.MongoClient,
    assert = require('assert'),
    co = require('co');

co(function*() {
    // Connection URL
    let db = yield MongoClient.connect('mongodb://localhost:27017/test');

    // update amfi schemecode holdings collection
    let holdings = db.collection('holdings');
    for (let map of amfiMap) {

    	let r = yield holdings.update(
	        { fundcode: map.fundcode },
	        { '$set': {amfischemecode: map.amfischemecode } },
	        { multi: true }
	    );

	}

	// update amfi schemecode transactions collection
    let txns = db.collection('transactions');

    r = yield holdings.find({}, {
        'amfischemecode': 1
    }).toArray();

    let holdIDCodeMap = {};
    for (let hold of r) {
        //console.log(hold);
        holdIDCodeMap[hold._id] = hold.amfischemecode;
    }
    try {
        for (let id in holdIDCodeMap) {
            r = yield txns.update(
                { holdingsid: new mongo.ObjectID(id) },
                { '$set': {schemecode: holdIDCodeMap[id]} },
                { multi: true }
            );    
        }
    } catch (err) {
        console.log(err);
    }

	db.close();
});
