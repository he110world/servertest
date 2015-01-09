var Util = require('./util');

// cannot use something like: table = require('./table.json'), since table.json make be updated.
function Girl(table) {
	if (table) {
		this.table = table;
	}
}

Girl.prototype.newGirl = function (id, table) {
	this.ID = id;
  	this.Lv = 1;
	this.GirlExp = 0;
	this.RankExp = 0;

	var girl = table.girl[id];
	this.Cost = girl.Cost;
	this.Rank = girl.Rank;
}

Girl.prototype.checkVar = function () {
	for (var i=0; i<arguments.length; i++) {
		var arg = arguments[i];
		if (typeof this[arg] == 'undefined') {
			throw new Error(arg);
		}
	}
}

Girl.prototype.addRankExp = function (expInc) {
	this.checkVar('table', 'RankExp', 'Rank');
	var mod = {};
	var Rank = Math.floor(this.Rank);
	var RankLimit = this.table.exp.Rank.length - 1;
	var newExp = Math.floor(this.RankExp) + Math.floor(expInc);
	var ret = Util.updateLevel(newExp, Rank, RankLimit, this.table.exp.RankExp);
	Rank = ret[0];
	newExp = ret[1];
	if (Rank != this.Rank) {
		mod.Rank = Rank;
	}
	mod.RankExp = this.RankExp = newExp;
	return mod;
}

Girl.prototype.addExp = function (expInc) {
	this.checkVar('table', 'GirlExp', 'Lv', 'Rank');
	var mod = {};
	var Lv = Math.floor(this.Lv);
	var Rank = Math.floor(this.Rank);
	var LvLimit = Math.floor(this.table.exp.LvLimit[Rank]);
	var newExp = Math.floor(this.GirlExp) + Math.floor(expInc);
	var ret = Util.updateLevel(newExp, Lv, LvLimit, this.table.exp.GirlExp);
	Lv = ret[0];
	newExp = ret[1];
	if (Lv != this.Lv) {
		mod.Lv = Lv;
	}
	mod.GirlExp = this.GirlExp = newExp;
	this.Lv = Lv;

	return mod;
}

module.exports = Girl;
