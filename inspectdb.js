//generate a JSON description of redis
var redis = require('redis');
var db = redis.createClient();
var desc = {};

// find all keys
db.keys('*', function(err,keys){
	// find base keys
	keys.sort();
	var basekey = {};	// basekey => fullkey
	for (var i=0; i<keys.length; i++) {
		var key = keys[i];
		var parts = key.split(/[.:]/);
		var base = parts[0];
		// choose the one with largest id
		// find possible id
		var id;
		var idx = -1;
		for (var j=parts.length-1; j>=0; j--) {
			id = parseInt(parts[j]);
			if (!isNaN(id)) {
				idx = j;
				break;
			}
		}
		var overwrite = true;
		if (basekey.hasOwnProperty(base)) {
			overwrite = false;
			var oldparts = basekey[base].fullkey.split(/[.:]/);
			if (idx>=0) {
				var oldid = oldparts[idx];
				if (id > oldid) {
					overwrite = true;
				}
			}
		}
		if (overwrite) {
			basekey[base] = {fullkey:key};
		}
	}

	// get base key types
	var cnt = 0;
	function beginOp() {
		++cnt;
	}

	function endOp() {
		--cnt;
		if (cnt <= 0) {
			var outstr = JSON.stringify(basekey);
			console.log(outstr);
			process.exit();
		}
	}

	for (var base in basekey) {
		var full = basekey[base].fullkey;
		db.type(full, (function(base, full){return function(err,type){
			beginOp();
			basekey[base].type = type;
			switch(type) {
				case 'string':
					db.get(full, function(err,str){
						basekey[base].val = str;
						endOp();
					});
					break;
				case 'list':
					db.lrange(full, 0, -1, function(err,list){
						basekey[base].val = list;
						endOp();
					});
					break;
				case 'set':
					db.smembers(full, function(err,set){
						basekey[base].val = set;
						endOp();
					});
					break;
				case 'zset':
					db.zrange(full, 0, -1, function(err,zset){
						basekey[base].val = zset;
						endOp();
					});
					break;
				case 'hash':
					db.hgetall(full, function(err,hash){
						basekey[base].val = hash;
						endOp();
					});
					break;
				default:
					endOp();
					break;
			}
		}})(base, full));
	}
});

