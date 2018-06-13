print("Holding Id, Email, PAN, folio#, fundhouse, fundname, registrar, amfischemecode");
db.holdings.find().forEach(function(holds){
	print (
		holds._id
		+","+holds.email
		+","+holds.pan
		+","+holds.folionumber
		+","+holds.fundhouse
		+","+holds.fundname
		+","+holds.registrar
		+","+holds.amfischemecode
	)
})