var file = process.argv[2];
if (!file) {
	console.log('Usage: node gencmd.js yoursourcefile.js');
	process.exit();
}

require('shelljs/global');
var docs = grep('//@', file);
var lines = docs.split('\n');
var cmdlist = [];
var currobj
var tags = ['cmd', 'data', 'nosession', 'desc'];

function CmdObj () {
}
CmdObj.prototype.generate = function () {
	if (!this.cmd) {
		return '';
	}
	var out = this.cmd + ',{';
	var num = 0;
	out += '"cmd":"' + this.cmd + '"';
	if (this.data) {
		out += ';"data":{';
		for (var d in this.data) {
			if (d>0) {
				out += ';';
			}
			out += '"' + this.data[d] + '":{' + num++ + '}';
		}
		out += '}';
	}
	if (!this.nosession) {
		out += ';"session":{' + num++ + '}';
	}
	out += '},';
	if (this.desc) {
		out += this.desc;
	}
	out += '\n';
	return out;
}

for (var i in lines) {
	var line = lines[i];
	var pos;
	for (var t in tags) {
		var tag = tags[t];
		var tagsearch = '\/\/@' + tag;
		var pos = line.indexOf(tagsearch);
		if (pos == -1) {
			continue;
		}

		var data = line.slice(pos + tagsearch.length + 1);
		if (tag == 'cmd') {
			if (currobj) {
				cmdlist.push(currobj);
			}
			currobj = new CmdObj;
			currobj.cmd = data;
		} else if (tag == 'data') {
			currobj.data = currobj.data || [];
			currobj.data.push(data);
		} else if (tag == 'nosession') {
			currobj[tag] = 1;
		} else {
			currobj[tag] = data;
		}
	}
}

var outstr = 'id,cmd,desc\n';
for (var o in cmdlist) {
	outstr += cmdlist[o].generate();
}
console.log(outstr);
