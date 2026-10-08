const ANIMAL_NAMES = {
  'golden-cow': '母牛',
  'copper-cow': '公牛',
  'hornless-calf': '小牛',
  'reference-wolf': '狼',
  'baola-leopard': '豹拉',
};

function visible(node) {
  for (let n = node; n; n = n.parent) if (!n.visible) return false;
  const materials = Array.isArray(node.material) ? node.material : [node.material];
  return !node.isSprite && materials.some((m) => m && m.visible !== false && m.opacity !== 0);
}

// Selection never calls pat(), reserves an animal or changes a controller phase.
export function pickActionTarget(scene, ray, field, car) {
  scene.updateMatrixWorld(true);
  scene.traverseVisible((n) => {
    if (n.isSkinnedMesh) {
      n.skeleton.update();
      n.computeBoundingSphere();
      n.computeBoundingBox();
    }
  });
  const hit = ray.intersectObjects(scene.children, true).find((h) => visible(h.object));
  if (!hit) return { type: 'world', name: '田野动作' };
  const animals = Object.keys(ANIMAL_NAMES)
    .map((id) => field?.animals?.animal(id))
    .filter(Boolean);
  const confined = field?.corral?.animals ?? [];
  for (let n = hit.object; n; n = n.parent) {
    const animal = [...confined, ...animals].find((a) => a.group === n);
    if (animal)
      return { type: 'animal', animal, name: ANIMAL_NAMES[animal.id], point: hit.point.clone() };
    if (n === field?.corral?.model.gate) return { type: 'gate', name: '围栏门' };
    for (const [id, name] of [
      ['pvz-flagbearer', '旗手僵尸'],
      ['pvz-ploughman', '扶犁僵尸'],
      ['pvz-gargantuar', '大僵尸'],
      ['pvz-conehead', '路锥僵尸'],
      ['pvz-gatekeeper', '围栏看守'],
      ['pvz-lookout', '塔台瞭望员'],
    ])
      if (n === field?.zombies?.actor(id)?.object) return { type: 'actor', id, name };
    if (n === field?.woodenCart?.root) return { type: 'cart', name: '抓牛木车' };
    if (n === car) return { type: 'vehicle', name: '小车' };
  }
  return { type: 'world', name: '田野动作' };
}

export function createSceneActions({
  getField,
  getCar,
  getTimeOfDay,
  animalTap,
  animalCall,
  resetView,
  resetCar,
  selectLight,
}) {
  function actions(target) {
    const field = getField(),
      result = [];
    const add = (id, label, run, reason = '', group = '当前对象', detail = '') =>
      result.push({ id, label, run, reason, group, detail });
    if (!field) return [];
    const a = target?.animal,
      meadow = field.animals,
      corral = field.corral;
    if (a) {
      const confined = corral?.animals.includes(a);
      const valid = confined || meadow.animal(a.id) === a;
      if (!valid) return [];
      const unavailable = (action) => meadow.actionAvailability(a, action);
      const held = a.mode === 'recapture-held' || a.transportOwner === 'plough';
      add(
        'tap',
        a.id === 'reference-wolf' ? '触摸互动' : '拍一拍',
        () => {
          if (corral?.animals.includes(a)) {
            corral.touch(a, target.point);
            return true;
          }
          return meadow.touch(a, target.point, getCar(), animalTap);
        },
        confined
          ? held
            ? a.transportOwner === 'plough'
              ? '正在执行耕田任务'
              : '正在被抱着'
            : ''
          : unavailable('tap'),
        '当前对象',
        a.id === 'reference-wolf' ? '触摸后可能上山或追赶小牛' : '拍击会累计，可能触发动物互动',
      );
      add(
        'call',
        a.id === 'reference-wolf' ? '嚎叫一声' : '叫一声',
        () => animalCall({ id: a.id, instanceId: a.instanceId ?? a.id, x: a.x, z: a.z }),
        confined
          ? held
            ? a.transportOwner === 'plough'
              ? '正在执行耕田任务'
              : '正在被抱着'
            : ''
          : unavailable('call'),
        '当前对象',
        '只播放叫声，不触发拍击或追赶',
      );
      if (!confined && !a.transportOwner) {
        add(
          'graze',
          ['reference-wolf', 'baola-leopard'].includes(a.id) ? '低头嗅地' : '吃草',
          () => meadow.graze(a.id),
          unavailable('graze'),
        );
        add('turn', '转身走动', () => meadow.turn(a.id), unavailable('turn'));
        const asleep = !meadow.sleep.ready(a);
        add(
          asleep ? 'wake' : 'rest',
          asleep ? '起身' : '趴下休息',
          () => (asleep ? meadow.wake(a.id) : meadow.rest(a.id)),
          asleep
            ? unavailable('wake')
            : getTimeOfDay() !== 'night'
              ? '夜间才能休息'
              : unavailable('rest'),
        );
        if (a.id === 'reference-wolf') {
          const descent = meadow.mountain?.snapshot().phase === 'summit';
          add(
            'mountain',
            descent ? '下山' : '登山',
            () => (descent ? meadow.mountain.requestDescent() : meadow.mountain?.start(getCar())),
            descent ? '' : unavailable('mountain'),
          );
        }
        if (a.id === 'baola-leopard') {
          const descent = ['lookout', 'lying-down', 'resting'].includes(
            meadow.tree?.snapshot().phase,
          );
          add(
            'tree',
            descent ? '下树' : '上树',
            () => (descent ? meadow.tree.requestDescent() : meadow.tree?.start(getCar())),
            descent ? '' : unavailable('tree'),
          );
        }
      }
    }
    if (target?.type === 'gate') {
      const gate = corral.snapshot();
      add(
        'open-gate',
        '打开围栏门',
        () => corral.setManualGateOpen(true),
        gate.controlled ? '正在运输入栏' : '',
      );
      add(
        'close-gate',
        '关闭围栏门',
        () => corral.setManualGateOpen(false),
        gate.controlled ? '正在运输入栏' : '',
      );
    }
    if (target?.id === 'pvz-ploughman') {
      const task = field.paddyPloughing,
        state = task?.snapshot();
      if (!state?.active)
        add(
          'start-plough',
          '开始耕田',
          () => task.start(),
          task?.availability() ?? '耕田队伍尚未就绪',
        );
      else
        add(
          'stop-plough',
          state.phase === 'ploughing' ? '结束耕田' : '取消耕田',
          () => task.stop(),
          state.canStop ? '' : '正在送牛回栏并收好农具',
        );
    }
    if (target?.id === 'pvz-gatekeeper')
      add('guard-close', '请看守关门', () => corral?.requestGuardClose());
    if (target?.id === 'pvz-lookout') {
      const lookout = field.lookout,
        heist = field.calfHeist;
      add(
        'ring-bell',
        '摇铃铛',
        () => lookout.ring(),
        lookout && heist ? lookout.ringAvailability() : '瞭望员尚未就绪',
        '当前对象',
        '摇响塔台铃铛',
      );
      add(
        'calf-alarm',
        '小牛离群警报',
        () => heist.alertManual(),
        heist ? heist.alarmAvailability() : '抓牛角色尚未就绪',
        '当前对象',
        '摇铃通知车组抓捕小牛',
      );
    }
    const giant = target?.id === 'pvz-gargantuar',
      cart = target?.type === 'cart';
    if (giant || cart) {
      const h = field.calfHeist,
        r = field.calfRescue,
        calf = meadow?.animal('hornless-calf');
      const hs = h?.snapshot(),
        rs = r?.snapshot();
      const reason = h ? h.manualAvailability(calf) : '抓牛角色尚未就绪';
      const group = '小牛任务';
      if (giant) {
        add(
          'hold-calf',
          '抱起小牛',
          () => h.holdManual(calf),
          reason,
          group,
          '大僵尸走近、抱起后停留',
        );
        add(
          'put-down',
          '放下小牛',
          () => h.putDownManual(),
          hs?.phase === 'manual-hold' ? '' : '先让大僵尸抱起小牛',
          group,
        );
      }
      if (cart)
        add(
          'capture-calf',
          '出车抓牛',
          () => h.startManual(calf),
          reason,
          group,
          '抓牛车组出发，将小牛运回围栏',
        );
      if (giant) {
        add(
          'recapture-calf',
          '追回逃跑小牛',
          () => r.startManual(calf),
          r ? r.manualAvailability(calf) : '追回角色尚未就绪',
          group,
          '徒步追赶，仍可能被公牛打断',
        );
        const mode = hs?.carryMode === 'underarm' ? 'two-hand' : 'underarm';
        add(
          'carry-mode',
          mode === 'two-hand' ? '抱法：切换双手托抱' : '抱法：切换单臂抱',
          () => h.setCarryMode(mode),
          h && hs.phase === 'waiting' && !reason.includes('大僵尸') ? '' : '任务开始前才能切换抱法',
          group,
        );
      }
      if (
        hs?.manualTask &&
        ((giant && hs.manualTask === 'hold') || (cart && hs.manualTask === 'capture'))
      )
        add(
          'cancel-heist',
          '取消当前抓牛任务',
          () => h.cancelManual(),
          hs.manualCancel || hs.trigger.aborting || hs.trigger.abortRequested
            ? '正在安全结束任务'
            : hs.manualTask === 'capture' && (hs.carrying || field.woodenCart?.cargo)
              ? '已装运，完成入栏后结束'
              : '',
          group,
        );
      if (giant && rs?.manual)
        add(
          'cancel-rescue',
          '取消追回任务',
          () => r.cancelManual(),
          ['dropping', 'fleeing', 'airborne', 'landed', 'leaving'].includes(rs.phase)
            ? '正在安全结束任务'
            : '',
          group,
        );
    }
    if (target?.type === 'vehicle') {
      const group = '小车与镜头';
      add(
        'camera',
        '恢复车尾视角',
        () => {
          resetView();
          return true;
        },
        '',
        group,
      );
      for (const [id, label] of [
        ['off', '关闭车灯'],
        ['low', '近光灯'],
        ['high', '远光灯'],
      ])
        add(
          'light-' + id,
          label,
          () => {
            selectLight(id);
            return true;
          },
          '',
          group,
        );
      add(
        'reset-car',
        '小车回到起点',
        () => {
          resetCar();
          return true;
        },
        '',
        group,
      );
    }
    return result;
  }
  return {
    actions,
    status(target) {
      if (target?.id === 'pvz-flagbearer' || target?.id === 'pvz-ploughman')
        return getField()?.paddyPloughing?.status() ?? '';
      if (target?.id === 'pvz-lookout') {
        const mode = getField()?.lookout?.snapshot().ringMode;
        return mode === 'notice' ? '正在摇铃通知抓牛车组' : mode ? '正在摇铃' : '';
      }
      if (target?.type !== 'cart' && target?.id !== 'pvz-gargantuar') return '';
      const field = getField(),
        h = field?.calfHeist?.snapshot(),
        r = field?.calfRescue?.snapshot();
      if (h?.manualTask) {
        if (h.manualCancel || h.trigger.aborting || h.trigger.abortRequested)
          return '正在安全结束抓牛任务';
        const phases = {
          'manual-approach': '大僵尸正在走向小牛',
          'seek-calf': '正在寻找安全抱牛位置',
          'face-calf': '正在转身靠近小牛',
          'crouch-and-grip': '正在蹲下托住小牛',
          'lift-calf': '正在抱起小牛',
          'manual-hold': '已抱起，可选择放下小牛',
          'manual-lower': '正在安全放下小牛',
          'manual-release': '正在松手起身',
          'manual-leave': '正在退开，释放小牛',
          'lookout-notice': '瞭望员正在通知抓牛车组',
          'crew-boarding': '驾驶员和大僵尸正在一同上车',
        };
        return phases[h.phase] ?? (h.carrying ? '正在搬运小牛' : '抓牛车组正在执行运牛流程');
      }
      if (r?.manual) return r.carrying ? '大僵尸正在抱牛返回围栏' : '大僵尸正在执行追回任务';
      return '';
    },
    execute(target, id) {
      const action = actions(target).find((a) => a.id === id);
      if (!action) return { ok: false, message: '目标已不可用，请重新选择' };
      if (action.reason) return { ok: false, message: action.reason };
      const ok = !!action.run();
      const started = [
        'start-plough',
        'stop-plough',
        'ring-bell',
        'calf-alarm',
        'hold-calf',
        'capture-calf',
        'recapture-calf',
        'put-down',
        'cancel-heist',
        'cancel-rescue',
      ].includes(id);
      return {
        ok,
        message: ok
          ? action.label + (started ? '：已开始' : '：已执行')
          : id === 'call'
            ? '当前无法叫声：请检查音效开关、距离，或等待其他声音结束 / 叫声冷却'
            : '当前无法执行，请检查通道、落点或角色状态',
      };
    },
  };
}
