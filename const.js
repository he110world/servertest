var moment = require('moment');

function Const () {
	this.DEFAULT_GIRL = 10004;
	this.LV_UP_GIFT = 14046;
	this.BUY_GIRL_GIFT = 14047;
	this.TWITTER_SHARE_GIFT = 14051;
	this.REDEEM_USER_GIFT = 14052;
	this.REDEEM_OWNER_GIFT = 14053;
	this.BETA_TESTER_GIFT = 14054;
	this.PHOTON_ID = 12001;
	this.CREDIT_ID = 12000;
	this.GIRL_PRICE = 10;
	this.SLOT_PRICE = 10;
	this.MAX_SLOT = 400;
	this.MAX_FRIENDS = 50;
	this.MAX_ROOMS = 99999;
	this.MAX_LV = 999;
	this.MISSION_RESET_HOUR = 5;
	this.MISSION_ID_OFFSET = 15000;
	this.SCORE_RANK_MAX = 5000;
	this.CONTRIB_RANK_MAX = 30000;
	this.INFINITE_MODE_TYPE = 6;
}

//we need: 1. last login date 2. last gift id
Const.prototype.LOGIN_GIFT = function (date$id) {
	var nowdate = moment(Date.now()).format('YYYYMMDD');
	var lastgift;
	if (!date$id) {	// first time
		lastgift = 14000;
	} else {
		date$id = date$id.split('$');
		var lastdate = date$id[0];

		// already logged in
		if (lastdate == nowdate) {
			return null;
		}

		lastgift = Math.floor(date$id[1]);
	}

	var gift = Math.floor(lastgift) + 1;
	if (gift > 14016) {
		gift = 14009;
	}
	return gift;
}

Const.prototype.SCORE_GIFT = function (rank) {
	if (rank === null) {
		return null;
	}

	// rank start from 0
	++rank;

	// possibility from high to low
	if (rank > 5000)		return 14030;
	else if (rank > 4000)	return 14029;
	else if (rank > 3000) 	return 14028;
	else if (rank > 2000) 	return 14027;
	else if (rank > 1500) 	return 14026;
	else if (rank > 1000) 	return 14025;
	else if (rank > 600) 	return 14024;
	else if (rank > 400)	return 14023;
	else if (rank > 300) 	return 14022;
	else if (rank > 200) 	return 14021;
	else if (rank > 100) 	return 14020;
	else if (rank > 30) 	return 14019;
	else if (rank > 10) 	return 14018;
	else if (rank > 0)		return 14017;
	else					return null;
}

Const.prototype.CONTRIB_GIFT = function (rank) {
	if (rank === null) {
		return null;
	}

	if (rank > 30000)		return 14045;
	else if (rank > 20000)	return 14044;
	else if (rank > 12000) 	return 14043;
	else if (rank > 8000) 	return 14042;
	else if (rank > 6000) 	return 14041;
	else if (rank > 4000) 	return 14040;
	else if (rank > 2500) 	return 14039;
	else if (rank > 1500)	return 14038;
	else if (rank > 1000) 	return 14037;
	else if (rank > 800) 	return 14036;
	else if (rank > 600) 	return 14035;
	else if (rank > 400) 	return 14034;
	else if (rank > 200) 	return 14033;
	else if (rank > 100) 	return 14032;
	else if (rank > 0)		return 14031;
	else					return null;
}

Const.prototype.SAME_GIRL_GIFT = function (rare) {
	if (rare == 2) {
		return 14048;
	} else if (rare == 3) {
		return 14049;
	} else if (rare == 4) {
		return 14050;
	} else {
		return null;
	}
}

Const.prototype.SAME_GIRL_ITEM = function (rare) {
	return 12003 + rare;
}

module.exports = new Const();
