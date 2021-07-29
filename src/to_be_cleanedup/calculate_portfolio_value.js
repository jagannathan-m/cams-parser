const log = require("loglevel"),
    MongoClient = require('mongodb').MongoClient,
    config = require('config'),
    json2csv = require('json2csv').parse;

const mongodb_uri = config.mongodb.uri;
const dbclient = new MongoClient(mongodb_uri, { useUnifiedTopology: true });


async function getPortfolioVaule () {
  try {
    await dbclient.connect();
    let database = dbclient.db(config.mongodb.mutualfundDB);

    let dbHoldings = database.collection('holdings');

    let holdings_value = await dbHoldings.aggregate([

      // Join with user_info table
      {
          $lookup:{
              from: "mutualfundnavs",
              localField: "mutualfundsid",
              foreignField: "mutualfundsid",
              as: "nav_info"
          }
      },
      {
        $lookup:
        {
          from: "transactions",
          localField: "_id",
          foreignField: "holdingsid",
          as: "transactions"
        }
      },
      {
        $match:{
          $and: [
            { "nav_info.date": {"$eq": new Date("2020-11-18 00:00:00.000Z")} },
          ]
        }
      },
      {
          $addFields: { 
              "nav": {$toDouble: {"$first": "$nav_info.nav"}},
              "total_units": { "$round": [{"$sum": "$transactions.units"}, 3]}
          } 
      },
      {   
          $project:{
            "fundname": 1,
            "folionumber": 1,
            "email": 1,
            "amfi_code": 1,
            "fundname": 1,
            "nav": 1,
            "total_units": 1,
            "total_value": { "$round": [{"$multiply": [ "$nav", "$total_units"]} , 2] },
            "mutualfundsid": 1
          } 
      },
      { $sort : {"pan": 1, } }
    ]).toArray();
    
    console.log (json2csv(holdings_value));

  }  catch (err) {
    log.error("Error while update Database: "+ err);
  } finally {
    await dbclient.close();
  }

}


// navs of holding fund on a specific date


getPortfolioVaule()