var desc = {};

// convert db's json description to csv
if (process.argv.length < 3) {
	console.log('Usage: node inspectjson.js jsonfile.json [oldresult.csv] > result.csv');
	process.exit();
}

// output column names (1st row)
console.log('key,type,format,value,desc');

function Row(key, data) {
	this.key = key;
	this.type = data.type;
	this.format = this.getFormat(key, data);
	this.value = this.getValue(key, data);
	if (desc[key]) {
		this.desc = desc[key];
	} else {
		this.desc = '';
	}
}

function isNumber(val) {
	return !isNaN(parseInt(val));
}

Row.prototype.print = function () {
	console.log(this.key+','+this.type+','+this.format+','+this.value+','+this.desc);
}

Row.prototype.getFormat = function (key, data) {
	var parts = data.fullkey.split(/[.:]/);
	var format = parts[0];
	if (parts.length == 1) {
		return format;
	}

	// find possible id
	var seps = [];	// separators
	for (var i in data.fullkey) {
		var c = data.fullkey[i];
		if (c=='.' || c==':') {
			seps.push(c);
		}
	}
	for (var i=1; i<parts.length; i++) {
		var id = parseInt(parts[i]);
		
		if (isNumber(id)) {	// possible id (all kinds of names can be number too...)
			var s = seps[i-1];
			if (s == '.') {
				format += '.<'+parts[0]+'id>';
			} else {
				format += seps[i-1] + '<id>';
			}
		} else {		// not a number... a name?	
			format += seps[i-1] + '<name>';
			
		}
	}

	return format;
}

function getVal(val) {
	if (val.indexOf(',') != -1) {	// array string
		var vals = val.split(',');
		if (isNumber(vals[0])) {
			return '[<id>]';
		} else {
			return '[<name>]';
		}
	} else {
		if (isNumber(val)) {
			return '<id>';
		} else {
			return '<name>';
		}
	}
}

function getListVal(list) {
	if (list.length > 0) {
		// iterate over the list. If any element isn't numeric, the whole list is considered names
		var isnum = true;
		for(var i in list) {
			var val = list[i];
			if (val.indexOf(',') != -1) {
				val = val.split(',');
			}
			if (!isNumber(val)) {
				isnum = false;
				break;
			}
		}
		var type = isnum ? getVal(list[0]) : getVal(list[i]);
		return '['+type+']';
	} else {
		return '[<value>]';
	}
}

function getHashVal(obj) {
	var keytype, valtype;
	for (var key in obj) {
		if (isNumber(key)) {
			keytype = '<id>';
		} else {
			keytype = '<property>';
		}

		var val = obj[key];
		if (val.indexOf('"') != -1) {
			valtype = '<json>';
		} else if (isNumber(val)) {
			valtype = '<id>';
		} else {
			valtype = '<name>';
		}
	}
	return '{'+keytype+':'+valtype+'}';
}

Row.prototype.getValue = function (key, data) {
	var val = data.val;
	switch (data.type) {
		case 'string':
			return getVal(val);
		case 'list':
		case 'set':
		case 'zset':
			return getListVal(val);
		case 'hash':
			return getHashVal(val);
	}
	return '<none>';
}

var fs = require('fs');
function parseCsv(path) {
	var rows = fs.readFileSync(path, 'utf8').split('\n');
	var cols = rows[0].split(',');
	var desc = {};

	// extract key & desc
	var keycol=-1, desccol=-1;
	for (var i in cols) {
		if (cols[i] == 'key') {
			keycol = i;
		} else if (cols[i].replace('\r', '') == 'desc') {
			desccol = i;
		}
	}

	if (keycol>=0 && desccol>=0) {
		for (var i=1; i<rows.length; i++) {
			var rowcols = rows[i].split(',');
			var des = rowcols[desccol];
			if (!!des) {
				desc[rowcols[keycol]] = des;
			}
		}
	}

	return desc;
}

if (process.argv.length == 3) {
	var json = require('./'+process.argv[2]);
} else {
	var jsonname = process.argv[2];
	var csvname = process.argv[3];
	if (jsonname.indexOf('.json') == -1) {	// first param is csv
		var cname = jsonname;
		jsonname = csvname;
		csvname = cname;
	}
	var json = require('./'+jsonname);
	desc = parseCsv('./'+csvname);
}
for (var key in json) {
	var row = new Row(key, json[key]);
	row.print();
}
