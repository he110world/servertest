var util = require('./util');

function Girl(table) {
	if (table) {
		this.table = table;
	}
}

Girl.prototype.newGirl = function (id) {
	this.checkVar('table');
	this.ID = id;
  	this.Lv = 1;
	this.GirlExp = 0;
	this.RankExp = 0;

	var girl = this.table.girl[id];
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
	var rank = Math.floor(this.Rank);
	var rankLimit = this.table.exp.Rank.length - 1;
	var newExp = Math.floor(this.RankExp) + Math.floor(expInc);
	var ret = util.updateLevel(newExp, rank, rankLimit, this.table.exp.RankExp);
	rank = ret[0];
	newExp = ret[1];
	if (rank != this.Rank) {
		mod.Rank = Rank;
	}
	mod.RankExp = this.RankExp = newExp;
	this.Lv = Lv;

	return mod;
}

Girl.prototype.addExp = function (expInc) {
	this.checkVar('table', 'GirlExp', 'Lv', 'Rank');
	var mod = {};
	var Lv = Math.floor(this.Lv);
	var Rank = Math.floor(this.Rank);
	var LvLimit = Math.floor(this.table.exp.LvLimit[Rank]);
	var newExp = Math.floor(this.GirlExp) + Math.floor(expInc);
	var ret = util.updateLevel(newExp, Lv, LvLimit, this.table.exp.GirlExp);
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
