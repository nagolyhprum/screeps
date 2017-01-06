Memory.miners = Memory.miners || {
};

module.exports.loop = function () {
    
    for(var i in Memory.creeps) {
        if(!Game.creeps[i]) {
            delete Memory.creeps[i];
        }
    }
    
    var constructionSites = Object.keys(Game.constructionSites).map(name => Game.constructionSites[name]).sort((a, b) => (b.progress + b.progressTotal) - (a.progress + a.progressTotal));
    
    var spawns = Object.keys(Game.spawns).map(name => Game.spawns[name]);
    
    var spawn = spawns[0];
    
    var rooms = Object.keys(Game.rooms).map(name => Game.rooms[name]);
    
    rooms.forEach(addSites);
    
    var creeps = Object.keys(Game.creeps).map(name => Game.creeps[name]);
    
    var towers = rooms.reduce((towers, room) => [...towers, ...room.find(FIND_STRUCTURES, {
        filter : structure => structure.structureType === STRUCTURE_TOWER
    })], [])
    
    var groups = creeps.reduce((groups, creep) => {
        var type = creep.memory.type;
        var group = groups[type] = groups[type] || [];
        group.push(creep);
        return groups; 
    }, {});
    
    var sources = rooms.reduce((sources, room) => [...sources, ...room.find(FIND_SOURCES)], []);
    
    var hostiles = rooms.reduce((hostiles, room) => [...hostiles, ...room.find(FIND_HOSTILE_STRUCTURES), ...room.find(FIND_HOSTILE_CREEPS)], []);
    
    var dropped = rooms.reduce((dropped, room) => [...dropped, ...room.find(FIND_DROPPED_RESOURCES)], []).sort((a, b) => b.energy - a.energy);
    
    var stores = rooms.reduce((stores, room) => [...stores, ...room.find(FIND_STRUCTURES, {
        filter : structure => structure.storeCapacity < _.sum(structure.store) || structure.energy < structure.energyCapacity
    })], []).sort((a, b) => {
        var structures = [STRUCTURE_TOWER];
        if(structures.includes(a.structureType)) {
            return -1;
        } else if(structures.includes(b.structureType)) {
            return 1;
        }
        return (a.storeCapacity || a.energyCapacity) - (b.storeCapacity || b.energyCapacity);
    });
    
    towers.forEach(tower => {
        var hostile = tower.pos.findClosestByRange(hostiles);
        if(hostile) {
            tower.attack(hostile);
        } else {
            var hurt = creeps.find(creep => creep.hits < creep.hitsMax);
            tower.heal(hurt);
        }
    });
    
    //MINER CODE
    sources.forEach(source => {
        var body = [];
        var cost = 0;
        var max = spawn.room.energyCapacityAvailable;
        var parts = Math.floor(source.energyCapacity / 300 / 2);
        for(var i = 0; i < parts; i++) {
            cost += 150;
            if(cost <= max) {
                body.push(MOVE);
                body.push(WORK);
            }
        }
        makeCreep(spawns, source.id, "miner", body);
    });
    
    var total_time = 0, total_works = 0;
    groups.miner && groups.miner.forEach(creep => {
        
        var closest = creep.pos.findClosestByRange(dropped);
        
        if(closest) {
            creep.say(closest.energy);
        }
        
        var source = sources.find(source => source.id === creep.memory.id);
        switch(creep.harvest(source)) {
            case OK : {
                if(!creep.memory.finish) {
                    creep.memory.finish = new Date().getTime();
                }
                break;
            }
            case ERR_NOT_IN_RANGE : {
                creep.moveTo(source);
                break;
            }
        }
        if(creep.memory.start && creep.memory.finish) {
            total_time += (creep.memory.finish - creep.memory.start);
        }
        total_works += creep.getActiveBodyparts(WORK);
    });
    
    var resource_per_tick = total_works * 2;
    
    var ticks_to_travel = total_time / 1000 / (groups.miner ? groups.miner.length : 1) * 2; //round trip
    
    var capacity = 150;
    
    var need = Math.floor(resource_per_tick * ticks_to_travel / capacity / 2);
    
    console.log(need);
    
    //HARVESTERS CODE
    
    if(need && (!groups.harvester || groups.harvester.length < need)) {
        sources.forEach(source => {
            makeCreep(spawns, false, "harvester", [MOVE, CARRY, MOVE, CARRY, MOVE, CARRY]);
        });
    }
    
    groups.harvester && groups.harvester.forEach(creep => {
        if(isWorking(creep)) {
            var store = target(creep, stores);
            if(creep.transfer(store, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(store);
            }
        } else {
            var d = target(creep, dropped);
            if(creep.pickup(d) === ERR_NOT_IN_RANGE) {
                creep.moveTo(d);
                creep.memory.id = target.id;
            }
        }
    });
    
    //WORKERS CODE
    if(need && (!groups.worker || groups.worker.length < need)) {
        sources.forEach(source => {
            makeCreep(spawns, false, "worker", [MOVE, MOVE, CARRY, WORK]);
        });
    }
    
    groups.worker && groups.worker.forEach((creep, i) => {
        if(isWorking(creep)) {
            if(constructionSites.length && i < need / 2) {
                var cs = constructionSites[0];
                if(creep.build(cs) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(cs);
                }
            } else {
                var target = spawn.room.controller;
                if(creep.upgradeController(target) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(target);
                }
            }
        } else {
            var target = dropped.find(dropped => dropped.id === creep.memory.id) || dropped[0];
            if(creep.pickup(target) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target);
                creep.memory.id = target.id;
            }
        }
    });
    
    //FIGHTER CODE
    
    if((groups.worker && groups.worker.length >= need) && (groups.harvester && groups.harvester.length >= need) && (groups.miner && groups.miner.length >= sources.length)) {
        spawn.createCreep([TOUGH, TOUGH, TOUGH, MOVE, MOVE, MOVE, MOVE, MOVE, ATTACK, RANGED_ATTACK], undefined, {
            type : "fighter"
        });
    }
    
    groups.fighter && groups.fighter.forEach(creep => {
        creep.moveTo(40, 40);
        var hostile = creep.pos.findClosestByPath(hostiles);
        if(hostiles.length) {
            if(creep.attack(hostile) === ERR_NOT_IN_RANGE || creep.rangedAttack(hostile) === ERR_NOT_IN_RANGE) {
                creep.moveTo(hostile);
            }
        }
    });
};

function target(creep, targets) {
    var target = targets.find(target => target.id === creep.memory.target) || targets[0];
    if(target) {
        creep.memory.target = target.id;
    }
    return target;
}

function isWorking(creep) {
    if(!creep.memory.working && creep.carry.energy === creep.carryCapacity) { //if i am gathering and i am done
        creep.memory.working = true;
    } else if(creep.memory.working && creep.carry.energy === 0) { //if i am working and i am done
        creep.memory.working = false;
    }
    return creep.memory.working;
}

function makeCreep(spawns, id, type, body) {
    var plural = `${type}s`;
    if(!Memory[plural] || !Game.creeps[Memory[plural][id]]) {
        var result = spawns[0].createCreep(body, "creep_" + (new Date()).getTime(), {
            type,
            id,
            start : new Date().getTime()
        });
        if(_.isString(result) && id) {
            Memory[plural][id] = result;
        }   
    }
}

function addSite(room, site) {
    var cs = room.find(FIND_MY_CONSTRUCTION_SITES);
    if(cs.length < MAX_CONSTRUCTION_SITES) {
        var max = CONTROLLER_STRUCTURES[site][room.controller ? room.controller.level : 0];
        var built = room.find(FIND_MY_STRUCTURES, {
            filter : structure => structure.structureType === site 
        }).length;
        var toBuild = room.find(FIND_MY_CONSTRUCTION_SITES, {
            filter : cs => cs.structureType === site
        }).length;
        if(built + toBuild < max) {
            squareFrom(25, 25, (x, y) => {
                var terrain = room.lookForAtArea(LOOK_TERRAIN, y - 1, x - 1, y + 1, x + 1, true);
                var hasWall = terrain.reduce((hasWall, terrain) => hasWall || terrain.terrain === "wall", false);
                var goodSpot = (x + y) % 2 === 1 && !hasWall;
                var result = goodSpot ? room.createConstructionSite(x, y, site) : false;
                return x === 0 || result === OK;
            });   
        }
    }
}

function addSites(room) {
    if(room.controller && room.controller.my) {
        addSite(room, STRUCTURE_SPAWN);
        addSite(room, STRUCTURE_TOWER);
        addSite(room, STRUCTURE_EXTENSION);
        addSite(room, STRUCTURE_STORAGE);
        addSite(room, STRUCTURE_CONTAINER);
    }
}

function squareFrom(x, y, callback) {
    var range = 1;
    while(true) {
        var range2 = 2 * range;
        for(var i = 0; i < range2; i++) { //top left to right
            if(callback(x - range + i, y - range) || callback(x - range, y - range + i) || callback(x + range, y - range + i) || callback(x - range + i, y + range)) {
                return;
            }
        }
        range++;
    }
}