print("Holding Id, Transaction Date, Amount, units");
db.transactions.find({}, {
	_id:0,
	holdingsid:1,
	date:1,
	amount:1,
	units:1
}).forEach(function(txn){
	print (
		txn.holdingsid
		+","+txn.date.toLocaleFormat("%m/%d/%Y")
		+","+txn.amount
		+","+txn.units
	)
})