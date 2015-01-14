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
	else if (key.length==1 && value!==undefined)
		return obj[key[0]] = value;
	else if (key.length==0)
		return obj;
	else {
		obj[key[0]] = obj[key[0]] || {};
		return merge(obj[key[0]],key.slice(1), value);
	}
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

Transaction.prototype.delkey = function (key, hkey) {
	if (hkey) {
		this.keys.push('del ' + key+'.'+hkey);
	} else {
		this.keys.push('del ' + key);
	}
}

Transaction.prototype.skipkey = function () {
	this.keys.push(null);
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
			merge(self.obj, key, mobj);	
			this.cli = null;
		} else {
			this.db.hmset(fullkey, mobj, function(err,newval){
				merge(self.obj, key, mobj);	
				if (typeof cb == 'function') {
					cb(err,newval);
				}
			});
		}
	}
}

Transaction.prototype.sadd = function (key, add, cb) {
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

Transaction.prototype.hdel = function (key, hkey, cb) {
	var fullkey = key+':'+this.uid;
	if (this.mul) {
		this.mul.hdel(fullkey, hkey);
		this.delkey(key, hkey);
		return this;
	} else {
		var self = this;
		this.db.hdel(fullkey, hkey, function(err,count){
			merge(self.obj, key+'.'+hkey, null);
			if (typeof cb == 'function') {
				cb(err,count);
			}
		});
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
		var self = this;
		self.db[funcname](fullkey, function(err,data){
			merge(self.obj, key, data);
			if (typeof cb == 'function') {
				cb(err,data);
			}
		});
	}
}

module.exports = Transaction;
