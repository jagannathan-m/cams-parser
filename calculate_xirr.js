let MongoClient = require('mongodb').MongoClient,
    assert = require('assert'),
    co = require('co'),
    moment = require('moment'),
    _ = require('underscore');

function momentXIRR(values, dates, guess) {
    //https://gist.github.com/ghalimi/4669712
    // Credits: algorithm inspired by Apache OpenOffice

    // Calculates the resulting amount
    var irrResult = function(values, dates, rate) {
        var r = rate + 1;
        var result = values[0];
        for (var i = 1; i < values.length; i++) {
            result += values[i] / Math.pow(r, moment(dates[i]).diff(moment(dates[0]), 'days') / 365);
        }
         return result;
    }

    // Calculates the first derivation
    var irrResultDeriv = function(values, dates, rate) {
        var r = rate + 1;
        var result = 0;
        for (var i = 1; i < values.length; i++) {
            var frac = moment(dates[i]).diff(moment(dates[0]), 'days') / 365;
            result -= frac * values[i] / Math.pow(r, frac + 1);
        }
        return result;
    }

    // Check that values contains at least one positive value and one negative value
    var positive = false;
    var negative = false;
    for (var i = 0; i < values.length; i++) {
        if (values[i] > 0) positive = true;
        if (values[i] < 0) negative = true;
    }

    // Return error if values does not contain at least one positive value and one negative value
    if (!positive || !negative) return '#NUM!';

    // Initialize guess and resultRate
    var guess = (typeof guess === 'undefined') ? 0.1 : guess;
    var resultRate = guess;

    // Set maximum epsilon for end of iteration
    var epsMax = 1e-10;

    // Set maximum number of iterations
    var iterMax = 50;

    // Implement Newton's method
    var newRate, epsRate, resultValue;
    var iteration = 0;
    var contLoop = true;
    do {
        resultValue = irrResult(values, dates, resultRate);
        newRate = resultRate - resultValue / irrResultDeriv(values, dates, resultRate);
        epsRate = Math.abs(newRate - resultRate);
        resultRate = newRate;
        contLoop = (epsRate > epsMax) && (Math.abs(resultValue) > epsMax);
    } while (contLoop && (++iteration < iterMax));

    if (contLoop) return '#NUM!';

    // Return internal rate of return
    return resultRate;
}


co(function*() { try {
    // Connection URL
    let db = yield MongoClient.connect('mongodb://localhost:27017/test');
    //console.log("Connected correctly to server");

    let investmentTillDate = process.argv[2] ? new Date(process.argv[2]) : new Date(); 

    let holdings = db.collection('holdings');
    let transactions = db.collection('transactions');
    let amfinav = db.collection('amfinav');

    // getting all interested holdings for XIRR calculation
    let xirrFunds = yield holdings.find({
      //"email" : "malliga82@gmail.com"
      //"email" : "preethashankar83@gmail.com"
      //"pan": "AGOPJ2416K",
    },{
      '_id': 1,
      'amfischemecode': 1,
      'fundname': 1
    }).toArray();

    let schemeCodes = [];
    let schemeIds = []
    for (let xirrFund of xirrFunds) {
      schemeCodes.push(xirrFund.amfischemecode);
      schemeIds.push(xirrFund._id);
    }

    // getting all interested holding trasactions for XIRR calculation
    let xirrTxns = yield transactions.find({
      holdingsid: {$in: schemeIds},
      date : {
        $lte: investmentTillDate
      }
    },{
      '_id': 0,
      'date': 1,
      'units': 1,
      'amount': 1,
      'schemecode': 1
    }).toArray();

    // getting the navs for the holdings
    let xirrNAV = yield amfinav.find({
      schemecode: { $in: schemeCodes }
    }, {
      'schemecode': 1,
      'nav': 1,
      '_id': 0
    }).toArray();
    
    let dateValues = [],
      flowValues = [],
      totalValue = 0,
      fundAggregate = {
        txnDates: [],
        txnFlows: [],
        totalValue: 0,
        xirrDate: new Date('13-Aug-2016'),
        schemes: {}
      };

    for (let xirrFund of xirrFunds) {
      let schemecode = xirrFund.amfischemecode;
      let navHash = _.find(xirrNAV, {schemecode: schemecode});

      let schemeTxns = _.where(xirrTxns, {schemecode: schemecode});

      if (schemeTxns.length == 0) {
        continue;
      }
      if (fundAggregate.schemes[schemecode]) {
        continue;
      }
      fundAggregate.schemes[schemecode] = {
        txnDates: [],
        txnFlows: [],
        fundName: xirrFund.fundname,
        nav: navHash.nav,
        totalUnits: 0,
        totalValue: 0
      };

      let schemeHash = fundAggregate.schemes[schemecode];

      schemeHash.txnDates = _.map(schemeTxns, txn => { return txn.date });
      fundAggregate.txnDates = fundAggregate.txnDates.concat(schemeHash.txnDates);

      schemeHash.txnFlows = _.map(schemeTxns, txn => { return txn.amount*-1 });
      fundAggregate.txnFlows = fundAggregate.txnFlows.concat(schemeHash.txnFlows);
      
      let txnUnits = _.map(schemeTxns, txn => { return txn.units });
      let txnsTotalUnits = _.reduce(txnUnits, function(memo, num){ return memo + num; }, 0);
      schemeHash.totalUnits = txnsTotalUnits;

      let txnsTotalValue = txnsTotalUnits * schemeHash.nav;
      schemeHash.totalValue = txnsTotalValue;
      fundAggregate.totalValue += txnsTotalValue;
    }

    for (let schemecode in fundAggregate.schemes) {
      let fund = fundAggregate.schemes[schemecode];
      let fundXIRR = momentXIRR([...fund.txnFlows, fund.totalValue], [...fund.txnDates, fundAggregate.xirrDate]);
      console.log (`Holding Units; ${parseFloat(fund.totalUnits).toFixed(3)} | Current Value; ${parseFloat(fund.totalValue).toFixed(2)} | Fund Name; ${fund.fundName} | XIRR; ${(fundXIRR*100).toFixed(2)}%`)
    }
    fundAggregate.totalValue = fundAggregate.totalValue.toFixed(2);
    let overallXIRR = momentXIRR([...fundAggregate.txnFlows, fundAggregate.totalValue], [...fundAggregate.txnDates, fundAggregate.xirrDate]);
    console.log (`Valuation on: ${fundAggregate.xirrDate.toDateString()} for Investment till ${investmentTillDate.toDateString()}; Total value; ${fundAggregate.totalValue} | overall XIRR; ${(overallXIRR*100).toFixed(2)}%`)
    console.log ('---------------------------------');
    db.close()
} catch(e) {
  console.log(e);
}});
