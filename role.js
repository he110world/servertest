var Util = require('./util');

function Role(table) {
	if (table) {
		this.table = table;
	}
}

Role.prototype.newRole = function (id) {
	this.ID = id;
  	this.Lv = 1;
	this.RoleExp = 0;
	this.Cost = 50;
	this.EquipSlot = 30;
	this.Redeem = Util.randomString(48);
	this.NewUser = 1;
}

/*
Role.prototype.checkVar = function () {
	for (var i=0; i<arguments.length; i++) {
		var arg = arguments[i];
		if (typeof this[arg] === 'undefined') {
			throw new Error(arg);
		} else if (isNaN(this[arg])) {
			this[arg] = 0;
		}
	}
}
*/

Role.prototype.addExp = function (expInc) {
//	this.checkVar('table', 'RoleExp', 'Lv');
	var mod = {};
	var Lv = Math.floor(this.Lv);
	var oldExp = Math.floor(this.RoleExp);
	if (isNaN(oldExp)) {
		oldExp = 0;
	}
	var newExp = oldExp + Math.floor(expInc);
	var ret = Util.updateLevel(newExp, Lv, 999, this.table.exp.RoleExp, 1);
	Lv = ret[0];
	newExp = ret[1];
	if (Lv != this.Lv) {
		mod.Lv = Lv;
		var dLv = Lv - this.Lv;
		this.Cost += 0.5 * dLv;
	}
	mod.RoleExp = this.RoleExp = newExp;
	this.Lv = Lv;

	return mod;
}

module.exports = Role;
