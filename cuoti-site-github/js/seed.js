/* 错题站 · 首批示例数据
 * 来源：化学月考（20/33）的错题整理 + 对应知识点卡。
 * 首次打开或点击「载入示例数据」时导入。
 */
(function (root) {
  'use strict';

  var topics = [
    {
      id: 't-bond-energy',
      subject: '化学',
      name: '键能（Bond enthalpy）',
      definition: '断裂 1 mol 某种化学键（气态）所需吸收的能量，也叫键解离能。',
      formula: 'ΔH = ΣE(断键) − ΣE(成键)；键能恒为正值，键越强数值越大。',
      pitfalls: '① 键能没有负值，不要把它当成"有正负的能量变化"；② 断键吸热、成键放热；③ 用平均键能算出的 ΔH 只是近似值。'
    },
    {
      id: 't-enthalpy-sign',
      subject: '化学',
      name: '焓变符号与热化学方程式',
      definition: 'ΔH 是在恒压下按方程式进行时交换的热量：ΔH < 0 放热（体系 → 环境），ΔH > 0 吸热（环境 → 体系）。',
      formula: 'ΔH 与方程式系数绑定：系数 ×n，ΔH ×n；方程式反向，ΔH 变号。',
      pitfalls: '看到"生成 1 mol 某物"必须按系数折算（例：210 kJ ÷ 3 = 70 kJ）；不要把吸热方向的"环境→体系"写反。'
    },
    {
      id: 't-formation-combustion',
      subject: '化学',
      name: '生成焓 / 燃烧焓 / Hess 定律',
      definition: '标准生成焓：由元素最稳定单质生成 1 mol 化合物；标准燃烧焓：1 mol 物质在足量 O₂ 中完全燃烧。',
      formula: 'ΔH = ΣΔHf(产物) − ΣΔHf(反应物)　｜　ΔH = ΣΔHc(反应物) − ΣΔHc(产物)（注意方向相反）',
      pitfalls: '① 两套公式方向容易混；② 目标物系数不是 1 时要先折算；③ 元素单质的 ΔHf = 0。'
    },
    {
      id: 't-calorimetry',
      subject: '化学',
      name: '量热计算 q = mcΔT 与中和热',
      definition: '通过溶液温度变化求反应热：q = mcΔT，再换算成每摩尔反应热。',
      formula: 'q = m·c·ΔT（m 为溶液总质量）；ΔH = −q/n（n 为限量试剂或生成的水的物质的量）',
      pitfalls: '① m 要用溶液总质量（酸 + 碱），不是只算一种；② ΔT = Tmax − T初，要用自己读出的初温；③ 单位 J → kJ；④ 放热 ΔH 为负。'
    },
    {
      id: 't-rate-measure',
      subject: '化学',
      name: '反应速率的测定方法',
      definition: '测速率 = 测"某个随反应变化的物理量"随时间的变化：气体体积、质量、颜色/吸光度、电导率等。',
      formula: 'rate = Δ(物理量)/Δt；单位如 cm³ s⁻¹、mol dm⁻³ s⁻¹',
      pitfalls: '比色计只能用于"有颜色变化"的反应；选体积法还是质量法，取决于"哪个量变化足够大、好测量"。'
    },
    {
      id: 't-collision',
      subject: '化学',
      name: '碰撞理论与速率影响因素',
      definition: '反应发生需要分子以足够能量、正确方向碰撞（有效碰撞）；单位时间有效碰撞次数越多，速率越大。',
      formula: '浓度↑ / 压强↑ / 温度↑ / 表面积↑ / 催化剂 → 单位时间有效碰撞↑ → 速率↑',
      pitfalls: '解释题要写"三段"：起点（浓度高→碰撞多→快）、中段（浓度降→碰撞少→慢）、平台（某反应物耗尽→停止）。'
    },
    {
      id: 't-boltzmann',
      subject: '化学',
      name: 'Maxwell–Boltzmann 能量分布',
      definition: '固定量气体分子能量分布的曲线；曲线下总面积 = 分子总数，活化能 Ea 右侧的面积 ∝ 能反应的分子比例。',
      formula: '温度升高：峰变低、变宽、向右移；加催化剂：Ea 线左移（峰形不变）。',
      pitfalls: '催化剂只降低 Ea，不改变峰的形状；ΔH 与 Ea 是两回事。'
    },
    {
      id: 't-thermometric',
      subject: '化学',
      name: '热滴定曲线（thermometric titration）',
      definition: '逐步加入酸/碱并测温度，温度最高点对应"放热最多"＝恰好完全中和（等价点）。',
      formula: '等价体积 = 平台起点（或两段直线延长线的交点）；n(NaOH) = c × V',
      pitfalls: '不要取"某个最高点"，要取平台开始的位置；初始温度用前几个点外推到加入量为 0。'
    }
  ];

  function mk(p) {
    return {
      id: p.id,
      subject: p.subject || '化学',
      source: p.source || '',
      date: p.date || '2026-10-16',
      topics: p.topics || [],
      causes: p.causes || [],
      difficulty: p.difficulty || 2,
      status: p.status || 'new',
      question: p.question,
      myAnswer: p.myAnswer || '',
      correctAnswer: p.correctAnswer || '',
      markScheme: p.markScheme || [],
      note: p.note || '',
      imageIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      review: { due: '2026-10-20', interval: 0, ease: 2.5, reps: 0 }
    };
  }

  var items = [
    mk({
      id: 'seed-c4',
      source: '化学月考 · 选择题 Q4',
      topics: ['t-bond-energy'],
      causes: ['K'],
      question: 'Which statement about bond enthalpies is correct?\nA. 强键的键能为正，弱键的键能为负\nB. 离子键的键能比共价键大\nC. 断键放热、成键吸热\nD. 键能越高代表键越强，弱键数值更低',
      myAnswer: 'A',
      correctAnswer: 'D',
      markScheme: [
        { point: '键能 = 断裂 1 mol 该键（气态）所需能量', missed: false },
        { point: '键能恒为正值，键越强数值越大', missed: true },
        { point: '断键吸热、成键放热', missed: false }
      ],
      note: '选 A 是把键能当成"有正负的能量变化"。记住：键能是一把尺子，只有大小、没有正负。'
    }),
    mk({
      id: 'seed-c5',
      source: '化学月考 · 选择题 Q5',
      topics: ['t-enthalpy-sign'],
      causes: ['K'],
      question: 'CH₄ + H₂O → 3H₂ + CO，ΔH = +210 kJ。生成 1 mol H₂ 时发生的能量变化是？\nA. 70 kJ 热量转化为焓\nB. 70 kJ 热量传给环境\nC. 210 kJ 热量从环境吸收\nD. 210 kJ 焓转化为热',
      myAnswer: 'B',
      correctAnswer: 'A',
      markScheme: [
        { point: 'ΔH 与方程式系数绑定：按方程式进行吸热 210 kJ', missed: false },
        { point: '生成 1 mol H₂ 只有方程式的 1/3 → 210 ÷ 3 = 70 kJ', missed: true },
        { point: 'ΔH > 0 为吸热：能量从环境进入体系', missed: true }
      ],
      note: '两个错点同时踩：没做 1/3 折算 + 吸热方向弄反。'
    }),
    mk({
      id: 'seed-c6',
      source: '化学月考 · 选择题 Q6',
      topics: ['t-rate-measure'],
      causes: ['K', 'M'],
      question: '哪组反应能用比色计（colorimeter）测到吸光度变化？\nA. KCl(aq) + Br₂(aq)\nB. Cu(s) + NaCl(aq)\nC. HCl(aq) + NaOH(aq)\nD. H₂O₂(aq) + KMnO₄(aq)',
      myAnswer: 'A',
      correctAnswer: 'D',
      markScheme: [
        { point: '比色计只能测有颜色变化的反应（有色物质生成或消失）', missed: true },
        { point: 'KMnO₄ 紫色被 H₂O₂ 还原而褪色 → 吸光度变化', missed: false },
        { point: 'A、B 不反应；C 无颜色变化', missed: true }
      ],
      note: '当时注了"A 不反应"（正确），但没有顺手把 C 排除。'
    }),
    mk({
      id: 'seed-c11',
      source: '化学月考 · 选择题 Q11',
      topics: ['t-formation-combustion'],
      causes: ['M'],
      question: 'Which expression gives the standard enthalpy change of combustion of ethane?\nA. ΔHf(C₂H₆) + 2ΔHf(CO₂) − 3ΔHf(H₂O)\nB. 2ΔHf(CO₂) + 3ΔHf(H₂O) − ΔHf(C₂H₆)\nC. 2ΔHf(C₂H₆) − 6ΔHf(H₂O) − 4ΔHf(CO₂)\nD. 4ΔHf(CO₂) + 6ΔHf(H₂O) − 2ΔHf(C₂H₆)',
      myAnswer: 'C',
      correctAnswer: 'B',
      markScheme: [
        { point: '先写 1 mol 燃烧方程式：C₂H₆ + 3½O₂ → 2CO₂ + 3H₂O', missed: true },
        { point: 'ΔHc = ΣΔHf(产物) − ΣΔHf(反应物)', missed: false },
        { point: 'C₂H₆ 前系数是 1，不能乘 2', missed: true }
      ],
      note: '选项 C 同时踩了两个坑：把 C₂H₆ 乘了 2 + 符号方向取反。'
    }),
    mk({
      id: 'seed-16c',
      source: '化学月考 · Q16(c)',
      topics: ['t-rate-measure'],
      causes: ['E'],
      question: '为什么"测量氢气体积随时间变化"比"测量反应物质量损失随时间变化"更好？',
      myAnswer: '因为气体的体积太小',
      correctAnswer: 'H₂ 摩尔质量很小 → 质量损失极小（约 0.1 g 以内），相对天平精度误差大；而气体体积大、可连续读数，测量更准确。',
      markScheme: [
        { point: '答出"质量损失太小、难以测准"', missed: true },
        { point: '答出"体积法更准 / 可连续读数"', missed: true }
      ],
      note: '把"哪个量小"说反了。模板：因为（哪个量太小/难测），所以（换测哪个量更准、更方便）。'
    }),
    mk({
      id: 'seed-17c',
      source: '化学月考 · Q17(c)',
      topics: ['t-thermometric', 't-calorimetry'],
      causes: ['M'],
      question: '用热滴定曲线求乙酸浓度：50.0 cm³ 的 0.995 mol dm⁻³ NaOH 与乙酸反应，求 c(CH₃COOH)。',
      myAnswer: '1.91 mol dm⁻³（用了 26 cm³）',
      correctAnswer: '1.99 mol dm⁻³（取平台起点 25.0 cm³）',
      markScheme: [
        { point: '读图：放热最多时酸的体积 ≈ 25.0 cm³（平台起点/两直线交点）', missed: true },
        { point: 'n(NaOH) = 0.0500 × 0.995 = 0.04975 mol', missed: false },
        { point: 'c = 0.04975 / 0.0250 = 1.99 mol dm⁻³', missed: false }
      ],
      note: '等价点要取"平台起点"，不是随便挑一个最高点。'
    }),
    mk({
      id: 'seed-17di',
      source: '化学月考 · Q17(d)(i)',
      topics: ['t-calorimetry'],
      causes: ['C'],
      question: '求中和反应放出的热量 q（kJ）。已知：50.0 cm³ NaOH + 约 25.0 cm³ 酸，温度由 21.5 °C 升到 29 °C，c = 4.18 J g⁻¹ °C⁻¹。',
      myAnswer: 'q = 4.18 × 50 × 8.5 = 1776.5 J ≈ 1.78 kJ',
      correctAnswer: 'm = 50.0 + 25.0 ≈ 75 g；ΔT = 29 − 21.5 = 7.5 °C；q = 4.18 × 75 × 7.5 = 2351 J ≈ 2.4 kJ',
      markScheme: [
        { point: 'm 用溶液总质量（酸 + 碱）', missed: true },
        { point: 'ΔT 用 Tmax − T初，且与自己读出的初温一致', missed: true },
        { point: '单位 J → kJ', missed: false }
      ],
      note: '两个坑都踩了：m 只用了一种溶液、ΔT 用了 8.5（应为 7.5）。'
    }),
    mk({
      id: 'seed-17dii',
      source: '化学月考 · Q17(d)(ii)',
      topics: ['t-calorimetry'],
      causes: ['C'],
      question: '求中和焓 ΔH（kJ mol⁻¹）。',
      myAnswer: '−35.7',
      correctAnswer: '−47',
      markScheme: [
        { point: 'ΔH = −q/n', missed: false },
        { point: 'n 用限量试剂：n(NaOH) = 0.04975 mol', missed: false },
        { point: '放热为负号，单位 kJ mol⁻¹', missed: false }
      ],
      note: '公式是对的，但 q 先用错（1.78 kJ）导致连锁错。先算对 q 再代入。'
    }),
    mk({
      id: 'seed-17ei',
      source: '化学月考 · Q17(e)(i)',
      topics: ['t-collision'],
      causes: ['E'],
      question: '用碰撞理论解释曲线 X 的形状（先陡后平，最终体积比 Y 大）。',
      myAnswer: '开头曲线更高，因为更容易碰撞；浓度最大所以速率最大；浓度下降碰撞频率下降',
      correctAnswer: '① 初始陡：浓度最大 → 单位时间有效碰撞最多 → 速率最大；② 渐平：浓度下降 → 碰撞频率下降 → 速率减小；③ 平台：某反应物耗尽，反应停止。',
      markScheme: [
        { point: '起点陡：浓度高 → 碰撞频率高 → 速率大', missed: false },
        { point: '浓度下降 → 碰撞频率下降 → 速率减小', missed: false },
        { point: '平台 = 某反应物耗尽（不是"气体体积大"）', missed: true }
      ],
      note: '知识点其实会，但没按三段式写，且句子把"体积大"和"更易碰撞"混在了一起。'
    })
  ];

  root.SEED = { version: 1, topics: topics, items: items };
})(typeof globalThis !== 'undefined' ? globalThis : this);
