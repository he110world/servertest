var args = process.argv.slice(2);
var file = args[0];
if (!file) {
	console.log('Usage: node exporttables.js table.xls* --skip name1 name2');
	process.exit();
}

var skips = [];
var state = '';
for (var i=1; i<args.length; i++) {
	if (args[i] == '--skip' || args[i] == '-s') {
		state = 'skip';
		continue;
	}

	if (state == 'skip') {
		skips.push(args[i]);
	}
}

var excel = require('node-xlsx');
var obj = excel.parse(file);
var table = {};
for (var i in obj) {
	var sheet = obj[i];
	if (skips.indexOf(sheet.name) != -1) {
		continue;
	}

	if (sheet.name == 'exp') {	// exp table is different
		// exp structure:
		// exp : {
		//		Lv : [...]
		//		RoleExp : [...]
		//		GirlExp : [...]
		// }
		// line 2 is column name
		var exp = {};
		var columns = sheet.data[2];
		var numrows = sheet.data.length - 3;
		for (var j in columns) {
			var col = columns[j];
			var vals = [0];	// exp ID starts from 1
			for (var k=0; k<numrows; k++) {
				var val = sheet.data[k+3][j];
				if (k>0 && val==0) {	// first data row can contain 0's
					break;
				}
				vals.push(val);
			}
			exp[col] = vals;
		}
		table.exp = exp;
	} else {
		// data structure:
		// data : {
		//		ID1 : {
		//			Name : xxx,
		//			Rare : xxx
		//		},
		//		ID2 : {
		//			Name : xxx,
		//			Rare : xxx
		//		}
		// }
		// line 2 is column name
		// find ID column
		var colnames = sheet.data[2];
		var IDcol = 0;
		for (var j in colnames) {
			if (colnames[j] == 'ID') {
				IDCol = j;
				break;
			}
		}
		var data = {};
		for (var j=3; j<sheet.data.length; j++) {
			var ID = sheet.data[j][IDcol];
			var onedata = {};
			for (var k in colnames) {
				var colname = colnames[k];
				if (colname) {
					onedata[colname] = sheet.data[j][k];
				}
			}
			data[ID] = onedata;
		}
		table[sheet.name] = data;
	}
}

console.log(JSON.stringify(table));
