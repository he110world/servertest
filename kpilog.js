/*
### Collections:
   user:
     {uid:<int>, os:<int>, ver:<int>, girlcnt:<int:incr>}
   payment:
     {uid:<int>, total:<int>} 
   <YYYY-MM-DD>:
     {uid:<int>, new:<int>, treat:<int>, guide:<int>, rolelv:<int>, map:<int>, pay:<int:incr>} 
   <YYYY-MM-DD>:stat:
	 {name:<string>, <id>:<int:incr/decr>}	
	 
	 possible names:
	 map:finish/giveup/continue
	 item:buy/own/use
	 girl:draw/lv

### Data Ops:
     set/incr (decr=-incr)

### Incoming Messages:
	 [<op type>, <collection>, <query>, <field>, <val>]*

	 e.g.
     ["s","user","uid:10000","os",1,"i","user","uid:10000","girlcnt",1]
 */
var moment = require('moment');

function KpiLog () {
	// init udp
	this.udp = require('dgram').createSocket('udp4');
	this.ip = 'localhost';	//TODO: options!
	this.port = 5566;		//TODO: options!
}

KpiLog.prototype.send = function (type, collection, query, field, val) {
	var obj = [type, collection, query, field, val];
	var msg = new Buffer(JSON.stringify(obj));
	this.udp.send(msg, 0, msg.length, this.port, this.ip);
}

KpiLog.prototype.set = function (collection, query, field, val) {
	this.send('s', collection, query, field, val);
}

KpiLog.prototype.incr = function (collection, query, field, val) {
	this.send('i', collection, query, field, val);
}

KpiLog.prototype.userset = function (uid, collection, field, val) {
	this.send('s', collection, 'uid:'+uid, field, val);
}

KpiLog.prototype.userincr = function (uid, collection, field, val) {
	this.send('i', collection, 'uid:'+uid, field, val);
}

KpiLog.prototype.todayop = function (op, qry, field, val) {
	var today = moment().format('YYYY-MM-DD');
	var qrystr = qry.toString();
	if (qrystr.indexOf(':') == -1) {
		this.send(op, today, 'uid:'+qry, field, val);
	} else {
		this.send(op, today+':stat', qry, field, val);
	}
}
KpiLog.prototype.todayset = function (qry, field, val) {
	this.todayop('s', qry, field, val);
}

KpiLog.prototype.todayincr = function (qry, field, val) {
	this.todayop('i', qry, field, val);
}

KpiLog.prototype.os = function (uid, os) {
	this.userset(uid, 'user', 'os', os);
}

KpiLog.prototype.ver = function (uid, ver) {
	this.userset(uid, 'user', 'ver', ver);
}

KpiLog.prototype.buyGirl = function (uid, girlid, isnew) {
	if (isnew) {
		this.userincr(uid, 'user', 'girlcnt', 1);
		this.todayincr('girl:lv', girlid+':1', 1);
	}
	this.todayincr('girl:draw', girlid, 1);
}

KpiLog.prototype.levelUp = function (uid, newlv) {
	this.todayset(uid, 'rolelv', newlv);
}

KpiLog.prototype.pay = function (uid, money) {
	this.todayincr(uid, 'pay', money);
	tihs.userincr(uid, 'payment', total, money);
}

module.exports = new KpiLog();
