const log = require("loglevel"),
    MongoClient = require('mongodb').MongoClient,
    config = require('config'),
    Fuse = require('fuse.js'),
    inquirer = require('inquirer');

const mongodb_uri = config.mongodb.uri;
const dbclient = new MongoClient(mongodb_uri, { useUnifiedTopology: true });

async function getFundHouseFunds (database, fundHouseName) {
  let dbMutualfunds = database.collection('mutualfunds');

  let strippedFundHouseName = fundHouseName.replace(/Mutual Fund/i, '');
  let fundHouseFunds = await dbMutualfunds.find(
      {"fund_house": { $regex: new RegExp('.*' + unescape(strippedFundHouseName) + '.*', 'i')}}, 
      {_id:1, fund_name: 1, amfi_code: 1}
    ).toArray()

  return fundHouseFunds
}

async function fuzzySearchFunds (database, fundHouseName, fullFundName) {

  let fundHouseFunds = await getFundHouseFunds(database, fundHouseName);

  // check is fund a Direct Fund
  let directFundRegex = new RegExp( ".*Direct.*", "i");
  let isSearchFundDirect = false;
  if (directFundRegex.test(fullFundName)) {
    isSearchFundDirect = true;
  } 
  // check is fund a Growth Fund
  let growthFundRegex = new RegExp( ".*Growth.*", "i");
  let isSearchFundGrowth = false;
  if (growthFundRegex.test(fullFundName)) {
    isSearchFundGrowth = true;
  } 
  
  let fundNamePrefix = fullFundName
    .split(/Fund/i)
    .map(function(item) {
      return item.trim();
    })
  
  if (fundNamePrefix.length === 1) {
    fundNamePrefix = fullFundName
    .split('-')
    .map(function(item) {
      return item.trim();
    })
  }
  
  let searchOptions = {
    isCaseSensitive: false,
    includeScore: true,
    threshold: 0.1,
    keys: ['fund_name']
  };
  let possibleFunds = [];
  do {
    let fuse = new Fuse(fundHouseFunds, searchOptions);
    possibleFunds = fuse.search(fundNamePrefix[0]);
  
    if (possibleFunds.length === 0) {
      searchOptions.threshold += 0.1;
    }
  } while ( possibleFunds.length === 0 && searchOptions.threshold <= 0.4 )
  
  if (possibleFunds.length === 0) {
    console.log(fullFundName)
  }

  let filteredFunds = [];
  for (let i=0; i < possibleFunds.length; i++) {
    let ispossibleFundsDirect = directFundRegex.test(possibleFunds[i].item.fund_name);
    let ispossibleFundsGrowth = growthFundRegex.test(possibleFunds[i].item.fund_name);
    if ( 
      ispossibleFundsDirect == isSearchFundDirect 
      && ispossibleFundsGrowth == isSearchFundGrowth ) {
        
      filteredFunds.push(possibleFunds[i])
    }
  }

  if (filteredFunds.length === 0) {
    log.info('No matches found for fund in holding: ' + fullFundName)
  }

  return {
    searchFund: fullFundName,
    possibleMatches: filteredFunds,
  }
}

async function getHoldingFundMatchings (database) {
  let dbHoldings = database.collection('holdings');

  let uniqFundsInholdings = await dbHoldings.aggregate([   
    { 
      "$match": { mutualfundsid: {$exists: false} }
    },
    {
      "$group": { "_id": { 
        fundname: "$fundname", 
        fundhouse: "$fundhouse", 
        fundcode: "$fundcode" } 
      }
    },
    {
      $project: {fundname: 1, fundhouse: 1, fundcode: 1}
    }   
  ]).toArray()
  // let holdings = await dbHoldings.find(
  //     {}, 
  //     {_id:1, fundname: 1, fundhouse: 1, fundcode: 1}
  //   ).toArray()

  let fundMatches = []
  for (let i = 0; i < uniqFundsInholdings.length; i++) {
    let fundname = uniqFundsInholdings[i]._id.fundname,
    // fundcode = uniqFundsInholdings[i]._id.fundcode,
    fundhouse = uniqFundsInholdings[i]._id.fundhouse;

    let fundMatch = await fuzzySearchFunds (database, fundhouse, fundname)

    uniqFundsInholdings[i].possibleAMFIFunds = fundMatch.possibleMatches;
  }

  return uniqFundsInholdings;
}

function trimmedFundName (fundname) {
  return fundname.toLowerCase()
    .replace(/\s*/g, '')
    .replace(/-/g,'')

}
async function mapHoldingsWithAMFIFund  () {
  try {
    await dbclient.connect();
    let database = dbclient.db(config.mongodb.mutualfundDB);

    let dbHoldings = database.collection('holdings');
    let uniqFundsInholdings = await getHoldingFundMatchings(database);

    for (let i=0; i< uniqFundsInholdings.length; i++ ) {
      let possibleAMFIFunds = uniqFundsInholdings[i].possibleAMFIFunds;
      let matchingFund;

      console.clear();
      if (possibleAMFIFunds.length === 0) {
        console.log('No exact match found for ' + uniqFundsInholdings[i]._id.fundname);
      } else if (possibleAMFIFunds.length === 1) {
        let fundMatchResponse = { isExactMatch: false };

        if (trimmedFundName(uniqFundsInholdings[i]._id.fundname)
            === trimmedFundName(possibleAMFIFunds[0].item.fund_name)) {

          fundMatchResponse.isExactMatch = true;
        } else {
          fundMatchResponse = await inquirer.prompt([{
            type: 'confirm',
            name: 'isExactMatch',
            default: false,
            message: [
              "Are these same fund?",
              "\t"+ uniqFundsInholdings[i]._id.fundname,
              "\t"+ possibleAMFIFunds[0].item.fund_name,
              "",
              "Answer: "
            ].join("\n").trim()
          }]);
        }

        if (fundMatchResponse.isExactMatch) {
          matchingFund = possibleAMFIFunds[0].item;
        }

      } else if (possibleAMFIFunds.length > 1) {

        let fundMatchResponse = { responseIndex: -1 };

        let userChoices = [];
        userChoices.push( new inquirer.Separator(uniqFundsInholdings[i]._id.fundname) )
        for (let i=0; i < possibleAMFIFunds.length; i++) {
          userChoices.push({
            name: possibleAMFIFunds[i].item.fund_name,
            value: i
          })
        }
        userChoices.push({ name: "None of the above", value: -1 })

        fundMatchResponse = await inquirer.prompt([{
          type: 'list',
          message: 'Select a matching fund',
          name: 'responseIndex',
          choices: userChoices,
        }]);

        if (fundMatchResponse.responseIndex >= 0) {
          matchingFund = possibleAMFIFunds[fundMatchResponse.responseIndex].item;
        }
      }

      if (matchingFund) {
        await dbHoldings.updateMany(
          { fundcode: uniqFundsInholdings[i]._id.fundcode },
          { $set: {
            mutualfundsid: matchingFund._id
          }}
        )
        console.log('Found exact match for "' + uniqFundsInholdings[i]._id.fundcode + '": ' + matchingFund.isin)
      }
    }
  } catch (err) {
    log.error("Error while update Database: "+ err);
  } finally {
    await dbclient.close();
  }
}


mapHoldingsWithAMFIFund ()
// test()
function test () {
  inquirer
  .prompt([
    {
      type: 'list',
      message: 'Select a matching fund',
      name: 'matchingFund',
      choices: [
        new inquirer.Separator(' = The Meats = '),
        {
          name: 'Pepperoni',
          value: 1,
        },
        {
          name: 'Ham',
          value: -1
        },
        {
          name: 'Ground Meat',
        },
        {
          name: 'Bacon',
        },
      ],
    },
  ])
  .then((answers) => {
    console.log(JSON.stringify(answers, null, '  '));
  });
}