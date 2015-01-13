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
						merge(self.obj, key, vals[i]);
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
		this.db.hmset(fullkey, mobj, function(err,newval){
			merge(self.obj, key, mobj);	
			if (typeof cb == 'function') {
				cb(err,newval);
			}
		});
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

Transaction.prototype.smembers = function (key, cb) {
	var fullkey = key+':'+this.uid;
	if (this.mul) {
		this.mul.smembers(fullkey);
		this.addkey(key);
		return this;
	} else {
		var self = this;
		this.db.smembers(fullkey, function(err,arr){
			merge(self.obj, key, arr);
			if (typeof cb == 'function') {
				cb(err,arr);
			}
		});
	}
}

Transaction.prototype.hgetall = function (key, cb) {
	var fullkey = key+':'+this.uid;
	if (this.mul) {
		this.mul.hgetall(fullkey);
		this.addkey(key);
		return this;
	} else {
		var self = this;
		this.db.hgetall(fullkey, function(err,data){
			merge(self.obj, key, data);
			if (typeof cb == 'function') {
				cb(err,data);
			}
		});
	}
}

module.exports = Transaction;
