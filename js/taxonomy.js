const research = [
  ['homomorphic', '同态加密', /同态加密|\bCKKS\b|\bBFV\b|\bBGV\b|\bTFHE\b/i],
  ['algebra', '数论与算法', /\bNTT\b|\bFFT\b|数论|多项式乘法/i],
  ['privacy', '隐私计算', /隐私|差分隐私|安全多方|联邦学习|机密计算/],
  ['ai-research', '人工智能研究', /\bAI\b|人工智能|机器学习|深度学习|论文|科研/i],
];
const computing = [
  ['os', '操作系统', /操作系统|\bLinux\b|\bkernel\b|内核/i],
  ['architecture', '计算机组成', /计算机组成|计算机原理|计算机体系|体系结构|\bCPU\b/i],
  ['networks', '计算机网络', /计算机网络|网络协议|\bTCP\b|\bUDP\b|\bHTTP\b|路由/i],
  ['compilers', '编译原理', /编译原理|编译器|\bLLVM\b|词法分析/i],
  ['chips', '数字芯片', /数字芯片|数字电路|\bFPGA\b|\bVerilog\b|\bASIC\b|\bRTL\b/i],
  ['language-models', '大语言模型', /大语言模型|大模型|\bLLM\b|\bGPT\b/i],
  ['embodied', '具身智能', /具身智能|机器人|\brobotics\b|\bVLA\b/i],
  ['embedded', '嵌入式', /嵌入式|单片机|\bARM\b|\bSTM32\b|\bESP32\b/i],
  ['edge', '边缘部署', /边缘|端侧|模型部署|推理部署|\bONNX\b/i],
  ['development', '开发实践', /编程|网页|博客搭建|\bHTML\b|\bCSS\b|\bJavaScript\b|\bPython\b/i],
];
const life = [
  ['travel', '行旅札记', /旅行|旅游|游记|徒步|露营/],
  ['food', '寻味札记', /美食|探店|餐厅|咖啡|风味/],
  ['games', '游艺札记', /游戏|通关|主机游戏|\bSteam\b/i],
  ['photography', '光影札记', /摄影|相机|照片|胶片|镜头/],
  ['fitness', '体能札记', /健身|力量训练|跑步|游泳|训练计划|运动恢复/],
  ['diet', '餐桌札记', /饮食|营养|食谱|控糖|做饭|减脂/],
  ['daily', '日常札记', /生活|随想|随笔|读书|感想|社交|交谈|自信|习惯/],
];

function group(id, title, category, entries) {
  return { id, title, topics: entries.map(([id, title, pattern]) => ({ id, title, pattern, category })) };
}

export const chapters = [
  { id: 'learning', title: '学习篇', href: '/learning/', groups: [
    group('research', '科研学习', 'privacy', research),
    group('computing', '计算机技术', 'technical', computing),
  ] },
  { id: 'life', title: '生活篇', href: '/life/', groups: [group('life', '生活札记', 'life', life)] },
];

export const groups = chapters.flatMap(chapter => chapter.groups);
export const topics = new Map(groups.flatMap(group => group.topics).map(topic => [topic.id, topic]));

export function articleTopic(post) {
  if (topics.has(post.topic)) return topics.get(post.topic);
  const tags = Array.isArray(post.tags) ? post.tags.join(' ') : post.tags || '';
  const value = `${tags} ${post.title || ''}`;
  const match = (ids, text = value) => ids.map(id => topics.get(id)).find(topic => topic.pattern.test(text));
  const personal = match(life.map(([id]) => id));
  if (post.category === 'life') return personal || topics.get('daily');
  // NTT articles belong to number theory even when they discuss homomorphic encryption.
  const theoryOrder = ['algebra', 'homomorphic', 'privacy'];
  const theory = match(theoryOrder, post.title || '') || match(theoryOrder);
  if (theory) return theory;
  const technology = match(['edge', 'embodied', 'language-models', 'chips', 'embedded', 'compilers', 'architecture', 'networks', 'os', 'development']);
  return technology || match(['ai-research']) || (post.category === 'privacy' ? topics.get('privacy') : (personal || topics.get('development')));
}

export function belongsToChapter(post, chapter) {
  return chapter.groups.some(group => group.topics.includes(articleTopic(post)));
}
