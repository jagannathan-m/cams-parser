let AmfiNAVParser = require ('./AmfiNAVParser');

let amfiParser;

amfiParser = new AmfiNAVParser({
    // startDate: '12-Nov-2020',
		// endDate: '12-Nov-2020',
		// navURL: 'file:/Users/mjagannathan/playbench/WealthApp/cams-parser/samplereports/amfi-range-nav.txt',
		// navURL: 'file:/Users/mjagannathan/playbench/WealthApp/cams-parser/samplereports/amfi-current-nav.txt',
		// navURL: 'https://www.amfiindia.com/spages/NAVAll.txt',
		// logLevel: 'debug'
});

amfiParser.loadNavContent();
