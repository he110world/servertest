function Transaction (db, uid) {
	this.db = db;
	this.mul = null;
	this.uid = uid;
	this.obj = {};
	this.res = {};
}

function merge(obj, key, value) {
	if (typeof key == 'string')
		return merge(obj, key.split('.'), value);
	else if (key.length==1 && value!==undefined) {
		var mobj = obj[key[0]];
		if (typeof mobj == 'object' && typeof value == 'object') {
			for (var v in value) {
				mobj[v] = value[v];
			}
			return mobj;
		} else {
			return obj[key[0]] = value;
		}
	}
	else if (key.length==0)
		return obj;
	else {
		obj[key[0]] = obj[key[0]] || {};
		return merge(obj[key[0]],key.slice(1), value);
	}
}

function remove(obj, key) {
	var keys = key.split('.');
	var last = keys.length-1;
	var o = obj;
	for (var i=0; i<last; i++) {
		var k = keys[i];
		o = o[k];
		if (o===undefined) {
			return;
		}
	}
	delete o[keys[last]];
	return obj;
}

Transaction.prototype.client = function () {
	this.cli = true;
	return this;
}

Transaction.prototype.multi = function () {
	this.mul = this.db.multi();
	this.keys = [];
	return this;
}

Transaction.prototype.exec = function (cb) {
	var self = this;
	if (this.mul) {
		this.mul.exec(function(err, vals){
			if (!err && vals.length == self.keys.length) {
				for (var i=0; i<self.keys.length; i++) {
					var key = self.keys[i];
					if (key) {
						if (key.indexOf('del ') != -1 && vals[i]>0) {
							merge(self.obj, key.slice(4), null);
						} else if (key.indexOf('json ') != -1) {
							merge(self.obj, key.slice(4), JSON.parse(vals[i]));
						} else if (key.indexOf('jo ') != -1) {
							var obj = {};
							var json = vals[i];
							for (var j in json) {
								obj[j] = JSON.parse(json[j]);
							}
							merge(self.obj, key.slice(3), obj);
						} else {
							merge(self.obj, key, vals[i]);
						}
					}
				}
			}
			if (typeof cb == 'function') {
				cb(err,vals);
			}
		});
		this.mul = null;
	}
}

Transaction.prototype.addkey = function (key, hkey) {
	if (hkey) {
		this.keys.push(key+'.'+hkey);
	} else {
		this.keys.push(key);
	}
}

/*
Transaction.prototype.delkeyarr = function (key, hkeyarr) {
	if (typeof hkeyarr == 'object') {
		var dels = {};
		for (var i in hkeyarr) {
			dels[hkeyarr] = null;
		}
		var obj = {};
		obj[key] = dels;
		this.keys.push('delarr ' + JSON.stringify(obj));
	} else {
		this.keys.push('del ' + key);
	}
}
*/

Transaction.prototype.delkey = function (key, hkey) {
	if (hkey) {
		this.keys.push('del ' + key+'.'+hkey);
	} else {
		this.keys.push('del ' + key);
	}
}

Transaction.prototype.addjsonkey = function (key, hkey) {
	if (hkey) {
		this.keys.push('json ' + key+'.'+hkey);
	} else {
		this.keys.push('json ' + key);
	}
}

Transaction.prototype.addjsonobj = function (key) {
	this.keys.push('jo ' + key);
}

Transaction.prototype.skipkey = function () {
	this.keys.push(null);
}

Transaction.prototype.hgetjson = function (key, hkey, cb) {
	var fullkey = key+':'+this.uid;
	if (this.mul) {
		this.mul.hget(fullkey, hkey);
		this.addjsonkey(key, hkey);
		return this;
	} else {
		var self = this;
		this.db.hget(fullkey, hkey, function(err,jsonstr){
			var obj = JSON.parse(jsonstr);
			merge(self.obj, key+'.'+hkey, obj);
			if (typeof cb == 'function') {
				cb(err,obj);
			}
		});
	}
}

Transaction.prototype.hgetalljson = function (key, cb) {
	var fullkey = key+':'+this.uid;
	if (this.mul) {
		this.mul.hgetall(fullkey);
		this.addjsonobj(key);
		return this;
	} else {
		var self = this;
		this.db.hgetall(fullkey, function(err,json){
			var obj = {};
			for (var i in json) {
				obj[i] = JSON.parse(json[i]);
			}
			merge(self.obj, key, obj);
			if (typeof cb == 'function') {
				cb(err,obj);
			}
		});
	}
}

// convert json object to string, and store string in db
Transaction.prototype.hsetjson = function (key, hkey, jsonobj, cb) {
	var fullkey = key+':'+this.uid;
	if (this.mul) {
		this.mul.hset(fullkey, hkey, JSON.stringify(jsonobj));
		this.skipkey();
		merge(this.obj, key+'.'+hkey, jsonobj);
		return this;
	} else {
		var self = this;
		this.db.hset(fullkey, hkey, JSON.stringify(jsonobj), function(err,addcount){
			merge(self.obj, key+'.'+hkey, jsonobj);
			if (typeof cb == 'function') {
				cb(err,addcount);
			}
		});
	}
}

Transaction.prototype.hset = function (key, hkey, val, cb) {
	var fullkey = key+':'+this.uid;
	if (this.mul) {
		this.mul.hset(fullkey, hkey, val);
		this.skipkey();
		merge(this.obj, key+'.'+hkey, val);
		return this;
	} else {
		var self = this;
		this.db.hset(fullkey, hkey, val, function(err,addcount){
			merge(self.obj, key+'.'+hkey, val);
			if (typeof cb == 'function') {
				cb(err,addcount);
			}
		});
	}
}

Transaction.prototype.hincrby = function (key, hkey, incr, cb) {
	var fullkey = key+':'+this.uid;
	if (this.mul) {
		this.mul.hincrby(fullkey, hkey, incr);
		this.addkey(key,hkey);
		return this;
	} else {
		var self = this;
		this.db.hincrby(fullkey, hkey, incr, function(err,newval){
			merge(self.obj, key+'.'+hkey, newval);	// wait for result
			if (typeof cb == 'function') {
				cb(err,newval);
			}
		});
	}
}

Transaction.prototype.zincrby = function (key, incr, member, cb) {
	if (this.mul) {
		this.mul.zincrby(key, incr, member);
		this.addkey(key,member);
		return this;
	} else {
		var self = this;
		this.db.zincrby(key, incr, member, function(err,newval){
			merge(self.obj, key, newval);
			if (typeof cb == 'function') {
				cb(err,newval);
			}
		});
	}
}


Transaction.prototype.hmset = function (key, mobj, cb) {
	var fullkey = key+':'+this.uid;
	merge(this.obj, key, mobj); // don't wait for result : it's already known
	if (this.mul) {
		this.mul.hmset(fullkey, mobj);
		this.skipkey();
		return this;
	} else {
		var self = this;
		if (this.cli) {
			this.cli = null;
		} else {
			this.db.hmset(fullkey, mobj, function(err,newval){
				if (typeof cb == 'function') {
					cb(err,newval);
				}
			});
		}
	}
}

Transaction.prototype.hmsetjson = function (key, mobj, cb) {
	var fullkey = key+':'+this.uid;
	merge(this.obj, key, mobj);
	var mstrobj = {};
	for (var i in mobj) {
		mstrobj[i] = JSON.stringify(mobj[i]);
	}
	if (this.mul) {
		this.mul.hmset(fullkey, mstrobj);
		this.skipkey();
		return this;
	} else {
		var self = this;
		if (this.cli) {
			this.cli = null;
		} else {
			this.db.hmset(fullkey, mstrobj, function(err,newval){
				if (typeof cb == 'function') {
					cb(err,newval);
				}
			});
		}
	}
}

Transaction.prototype.srem = function (key, rem, cb) {
	if (this.serv) {
		this.serv = false;
	} else {
		var mobj = {};
		if (typeof rem == 'object') {	// array
			for (var i in rem) {
				mobj[rem[i]] = null;
			}
		} else {
			mobj[rem] = null;
		}
		merge(this.obj, key, mobj);
	}

	var fullkey = key+':'+this.uid;
	if (this.mul) {
		this.mul.srem(fullkey, rem);
		this.skipkey();
		return this;
	} else {
		this.db.srem(fullkey, rem, function(err,count){
			cb(err,count);
		});
	}
}

Transaction.prototype.sadd = function (key, add, cb) {
	if (this.serv) {
		this.serv = false;
	} else {
		var mobj = {};
		if (typeof add == 'object') {	// array
			for (var i in add) {
				mobj[add[i]] = 1;
			}
		} else {	// single value
			mobj[add] = 1;
		}
		merge(this.obj, key, mobj);
	}

	var fullkey = key+':'+this.uid;
	if (this.mul) {
		this.mul.sadd(fullkey, add);
		this.skipkey();
		return this;
	} else {
		this.db.sadd(fullkey, add, function(err,count){
			cb(err,count);
		});
	}
}

Transaction.prototype.expire = function (key, sec, cb) {
	var fullkey = key+':'+this.uid;
	if (this.mul) {
		this.mul.expire(fullkey, sec);
		this.skipkey();
		return this;
	} else {
		this.db.expire(fullkey, sec, function(err,count){
			cb(err,count);
		});
	}
}

Transaction.prototype.del = function (key, cb) {
	var fullkey = key+':'+this.uid;
	this.obj[key] = null;
	if (this.mul) {
		this.mul.del(fullkey);
		this.skipkey();
		return this;
	} else {
		var self = this;
		this.db.del(fullkey, function(err,count){
			if (typeof cb == 'function') {
				cb(err,count);
			}
		});
	}
}

Transaction.prototype.hdel = function (key, hkey, cb) {
	var fullkey = key+':'+this.uid;
	if (this.mul) {
		if (typeof hkey == 'object') {
			this.mul.hdel.apply(this.mul, [fullkey].concat(hkey));
			for (var i in hkey) {
				this.obj[key] = this.obj[key] || {};
				this.obj[key][hkey[i]] = null;
			}
			this.skipkey();
		} else {
			this.mul.hdel(fullkey, hkey);
			this.delkey(key, hkey);
		}
		return this;
	} else {
		var self = this;
		if (typeof hkey == 'object') {
			this.db.hdel.apply(this.db, [fullkey].concat(hkey, function(err,count){
				for (var i in hkey) {
					self.obj[key] = self.obj[key] || {};
					self.obj[key][hkey[i]] = null;
				}
				if (typeof cb == 'function') {
					cb(err,count);
				}
			}));
		} else {
			this.db.hdel(fullkey, hkey, function(err,count){
				merge(self.obj, key+'.'+hkey, null);
				if (typeof cb == 'function') {
					cb(err,count);
				}
			});
		}
	}
}

Transaction.prototype.remove = function (key) {
	if (this.cli) {
		remove(this.obj, key);
		this.cli = null;
	}
}

Transaction.prototype.lrange = function (key, begin, end, cb) {
	var fullkey = key+':'+this.uid;
	if (this.mul) {
		this.mul.lrange(fullkey, begin, end);
		this.addkey(key);
		return this;
	} else {
		var self = this;
		this.db.lrange(fullkey, begin, end, function(err,arr){
			merge(self.obj, key, arr);
			if (typeof cb == 'function') {
				cb(err,arr);
			}
		});
	}
}

Transaction.prototype.lrem = function (key, count, val, cb) {
	var fullkey = key+':'+this.uid;
	if (this.mul) {
		this.mul.lrem(fullkey, count, val);
		this.skipkey();
		return this;
	} else {
		var self = this;
		this.db.lrem(fullkey, count, val, function(err,count){
			if (typeof cb == 'function') {
				cb(err,count);
			}
		});
	}
}

Transaction.prototype.rpush = function (key, val, cb) {
	var fullkey = key+':'+this.uid;
	if (this.mul) {
		this.mul.rpush(fullkey, val);
		this.skipkey();
		return this;
	} else {
		var self = this;
		this.db.rpush(fullkey, val, function(err,count){
			if (typeof cb == 'function') {
				cb(err,count);
			}
		});
	}
}

Transaction.prototype.lset = function (key, index, val, cb) {
	var fullkey = key+':'+this.uid;
	if (this.mul) {
		this.mul.lset(fullkey, index, val);
		this.skipkey();
		return this;
	} else {
		var self = this;
		this.db.lset(fullkey, index, val, function(err,count){
			if (typeof cb == 'function') {
				cb(err,count);
			}
		});
	}
}

Transaction.prototype.server = function () {
	this.serv = true;
	return this;
}

Transaction.prototype.get = function (key, cb) {
	var fullkey = key+':'+this.uid;
	if (this.mul) {
		this.mul.get(fullkey);
		this.addkey(key);
	} else {
		this.db.get(fullkey, function(err,val){
			if (typeof cb == 'function') {
				cb(err,val);
			}
		});
	}
}

Transaction.prototype.set = function (key, val, cb) {
	if (this.serv) {
		this.serv = false;
	} else {
		merge(this.obj, key, val);
	}
	var fullkey = key+':'+this.uid;
	if (this.mul) {
		this.mul.set(fullkey, val);
		this.skipkey();
		return this;
	} else {
		if (this.cli) {
			this.cli = null;
		} else {
			this.db.set(fullkey, val, function(err,count){
				if (typeof cb == 'function') {
					cb(err,count);
				}
			});
		}
	}
}

Transaction.prototype.smembers = function (key, cb) {
	return this.wrap1('smembers', key, true, cb);
}

Transaction.prototype.hgetall = function (key, cb) {
	return this.wrap1('hgetall', key, true, cb);
}

// funcname, arg1, arg2, ... ,argN, should-add-key, cb 
var slice = [].slice;	// cached slice is faster
Transaction.prototype.wrap = function () {
	var funcname = arguments[0];
	var args = slice.call(arguments, 1,-1);
	var addkey = arguments[arguments.length-2];
	var cb = arguments[arguments.length-1];
	if (this.mul) {
		this.mul[funcname](args);
		if (addkey) {
			this.addkey(args[0]);
		} else {
			this.addkey(null);
		}
		return this;
	} else {
		var self = this;
		this.apply(this.db[funcname], args.concat(function(err,data){
		}));
	}
}

Transaction.prototype.wrap1 = function (funcname, key, addkey, cb) {
	var fullkey = key+':'+this.uid;
	if (this.mul) {
		this.mul[funcname](fullkey);
		if (addkey) {
			this.addkey(key);
		} else {
			this.addkey(null);
		}
		return this;
	} else {
		if (this.cli) {
			this.cli = null;
		} else {
			var self = this;
			self.db[funcname](fullkey, function(err,data){
				merge(self.obj, key, data);
				if (typeof cb == 'function') {
					cb(err,data);
				}
			});
		}
	}
}

module.exports = Transaction;
