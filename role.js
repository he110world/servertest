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
	this.Redeem = Util.randomString(32);
}

Role.prototype.checkVar = function () {
	for (var i=0; i<arguments.length; i++) {
		var arg = arguments[i];
		if (typeof this[arg] == 'undefined') {
			throw new Error(arg);
		}
	}
}

Role.prototype.addExp = function (expInc) {
	this.checkVar('table', 'RoleExp', 'Lv');
	var mod = {};
	var Lv = Math.floor(this.Lv);
	var newExp = Math.floor(this.RoleExp) + Math.floor(expInc);
	var ret = Util.updateLevel(newExp, Lv, 999, this.table.exp.RoleExp, 1);
	Lv = ret[0];
	newExp = ret[1];
	if (Lv != this.Lv) {
		mod.Lv = Lv;
	}
	mod.RoleExp = this.RoleExp = newExp;
	this.Lv = Lv;

	return mod;
}

module.exports = Role;
