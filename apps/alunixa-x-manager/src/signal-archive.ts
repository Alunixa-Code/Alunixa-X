// [Covert Narrative System] Trigger: click the muted control-surface signature 7 times within 2.2 seconds | Core Theme: memory, waiting, and choosing whether being heard is enough | Endings: HE / BE / NE / TE

export type SignalArchiveLocale = "zh" | "en" | "ru";
export type SignalArchiveEnding = "he" | "be" | "ne" | "te";
export type SignalArchiveFlag =
  | "namedSelf"
  | "admittedLost"
  | "stayedSilent"
  | "heardWholeMessage"
  | "noticedLoop"
  | "keptMemory"
  | "editedMemory"
  | "chartedEcho"
  | "answeredEarly"
  | "offeredWarmth"
  | "askedIdentity"
  | "acceptedTruth"
  | "deniedTruth";

export type LocalizedLine = Record<SignalArchiveLocale, string>;

export type SignalArchiveChoice = {
  id: string;
  label: LocalizedLine;
  next: string;
  effects?: SignalArchiveFlag[];
  requires?: SignalArchiveFlag[];
  blocks?: SignalArchiveFlag[];
  tone?: "quiet" | "warm" | "danger" | "true";
};

export type SignalArchiveNode = {
  id: string;
  chapter: LocalizedLine;
  title: LocalizedLine;
  speaker: LocalizedLine;
  text: LocalizedLine;
  choices?: SignalArchiveChoice[];
  ending?: SignalArchiveEnding;
};

export type SignalArchiveState = {
  nodeId: string;
  flags: SignalArchiveFlag[];
  trail: string[];
};

export type SignalArchiveProgress = {
  endings: SignalArchiveEnding[];
  visits: number;
};

const line = (zh: string, en: string, ru: string): LocalizedLine => ({ zh, en, ru });

export const SIGNAL_ARCHIVE_UI = {
  station: line("L-9 远星中继站", "L-9 FAR RELAY", "ДАЛЬНИЙ РЕТРАНСЛЯТОР L-9"),
  status: line("低功耗唤醒", "LOW-POWER WAKE", "ПРОБУЖДЕНИЕ ИЗ ЭКО-РЕЖИМА"),
  close: line("离开中继站", "Leave the relay", "Покинуть ретранслятор"),
  skip: line("显示全部", "Reveal all", "Показать всё"),
  signal: line("信号完整度", "Signal integrity", "Целостность сигнала"),
  memory: line("记忆残片", "Memory fragments", "Фрагменты памяти"),
  route: line("本次轨迹", "Current route", "Текущий путь"),
  endings: line("已抵达结局", "Endings reached", "Открытые финалы"),
  noEndings: line("尚无记录", "No record yet", "Записей пока нет"),
  replay: line("从最初的呼吸重新开始", "Begin again from the first breath", "Начать снова с первого вдоха"),
  return: line("返回控制台", "Return to console", "Вернуться к консоли"),
  help: line("Esc 可随时离开，进度会保留在本机。", "Press Esc to leave. Progress stays on this device.", "Esc — выйти. Прогресс останется на этом устройстве."),
  endingLabels: {
    he: line("HE · 有人听见", "HE · SOMEONE HEARD", "HE · КТО-ТО УСЛЫШАЛ"),
    be: line("BE · 熄灯之后", "BE · AFTER THE LIGHTS", "BE · ПОСЛЕ ПОГАСШЕГО СВЕТА"),
    ne: line("NE · 继续值守", "NE · THE LONG WATCH", "NE · ДОЛГОЕ ДЕЖУРСТВО"),
    te: line("TE · 黎明没有回信", "TE · DAWN SENT NO REPLY", "TE · РАССВЕТ НЕ ОТВЕТИЛ"),
  },
} as const;

export const SIGNAL_ARCHIVE_NODES: Record<string, SignalArchiveNode> = {
  wake: {
    id: "wake",
    chapter: line("序章 · 冻结的呼吸", "PROLOGUE · A FROZEN BREATH", "ПРОЛОГ · ЗАМЁРЗШЕЕ ДЫХАНИЕ"),
    title: line("中继站在你之前醒来", "The relay wakes before you", "Ретранслятор просыпается раньше тебя"),
    speaker: line("L-9 自动值守系统", "L-9 WATCH SYSTEM", "СИСТЕМА ДЕЖУРСТВА L-9"),
    text: line(
      "备用电池在黑暗里咳嗽了一声。十七年没有指令的中继站，忽然把最后一盏灯留给了你。\n\n“请确认身份。”一个很轻的声音说，“如果你也忘了，就告诉我。我们可以从不知道彼此开始。”",
      "The backup battery coughs once in the dark. After seventeen years without a command, the relay gives its final lamp to you.\n\n“Confirm your identity,” says a quiet voice. “If you forgot too, tell me. We can begin by not knowing each other.”",
      "Резервная батарея один раз кашляет во тьме. После семнадцати лет без приказов ретранслятор отдаёт тебе свою последнюю лампу.\n\n«Подтверди личность», — тихо говорит голос. «Если ты тоже забыл, скажи. Мы можем начать с того, что не знаем друг друга»."
    ),
    choices: [
      { id: "name", label: line("报上一个仍记得的名字", "Give a name you still remember", "Назвать имя, которое ещё помнишь"), next: "threshold", effects: ["namedSelf"], tone: "warm" },
      { id: "lost", label: line("承认自己什么也不记得", "Admit that you remember nothing", "Признаться, что ничего не помнишь"), next: "threshold", effects: ["admittedLost"], tone: "quiet" },
      { id: "silence", label: line("保持沉默，只听它呼吸", "Stay silent and listen to it breathe", "Молчать и слушать его дыхание"), next: "threshold", effects: ["stayedSilent"], tone: "true" },
    ],
  },
  threshold: {
    id: "threshold",
    chapter: line("第一章 · 两扇门", "CHAPTER I · TWO DOORS", "ГЛАВА I · ДВЕ ДВЕРИ"),
    title: line("十七年的沉默留下两个房间", "Seventeen years left two rooms", "Семнадцать лет оставили две комнаты"),
    speaker: line("值守员 · 岚", "WATCHER · LAN", "ДЕЖУРНАЯ · ЛАНЬ"),
    text: line(
      "声音说自己叫岚。它守着一份没有寄出的私人档案，也守着一道每晚四点十七分准时出现的微弱信号。\n\n能源只够再完成一次远距传输，但在决定之前，你仍有时间走进两间房。",
      "The voice calls itself Lan. It guards an unsent private archive and a faint signal that returns every night at 04:17.\n\nThere is power for one final long-range transmission, but before deciding, you still have time to enter both rooms.",
      "Голос называет себя Лань. Она хранит неотправленный личный архив и слабый сигнал, который возвращается каждую ночь в 04:17.\n\nЭнергии хватит на одну последнюю дальнюю передачу, но прежде можно войти в обе комнаты."
    ),
    choices: [
      { id: "archive", label: line("走进记忆库", "Enter the memory vault", "Войти в хранилище памяти"), next: "archiveDoor", tone: "warm" },
      { id: "beacon", label: line("爬上信标塔", "Climb the beacon tower", "Подняться на сигнальную башню"), next: "beaconRoom", tone: "quiet" },
    ],
  },
  archiveDoor: {
    id: "archiveDoor",
    chapter: line("第二章 · 未寄出的雪", "CHAPTER II · UNSENT SNOW", "ГЛАВА II · НЕОТПРАВЛЕННЫЙ СНЕГ"),
    title: line("档案编号不是日期，而是一句道歉", "The archive number is an apology", "Номер архива оказался извинением"),
    speaker: line("记忆库 / 私人记录", "MEMORY VAULT / PRIVATE LOG", "ХРАНИЛИЩЕ / ЛИЧНАЯ ЗАПИСЬ"),
    text: line(
      "门后没有文件柜，只有一场被压缩成蓝色噪点的雪。岚说，最后一任值守员名叫舟。撤离那天，他把一段话留在这里，却没有按下发送。\n\n记录的时间戳每隔十七年重复一次，像有人把同一个夜晚折成了许多层。",
      "There are no cabinets behind the door, only snow compressed into blue noise. Lan says the last human watcher was named Zhou. On evacuation day, he left a message here and never pressed send.\n\nIts timestamp repeats every seventeen years, as if someone folded the same night into many layers.",
      "За дверью нет шкафов — только снег, сжатый в синюю рябь. Лань говорит, последнего дежурного звали Чжоу. В день эвакуации он оставил сообщение, но так и не нажал «отправить».\n\nМетка времени повторяется каждые семнадцать лет, словно одну ночь сложили во много слоёв."
    ),
    choices: [
      { id: "listen", label: line("从第一秒听到最后一秒", "Listen from the first second to the last", "Прослушать от первой секунды до последней"), next: "archiveLetter", effects: ["heardWholeMessage"], tone: "warm" },
      { id: "timestamp", label: line("先比对所有重复的时间戳", "Compare every repeating timestamp first", "Сначала сравнить все повторяющиеся метки"), next: "archiveLetter", effects: ["noticedLoop", "heardWholeMessage"], tone: "true" },
    ],
  },
  archiveLetter: {
    id: "archiveLetter",
    chapter: line("第二章 · 未寄出的雪", "CHAPTER II · UNSENT SNOW", "ГЛАВА II · НЕОТПРАВЛЕННЫЙ СНЕГ"),
    title: line("“等天亮时，替我把窗打开”", "“When morning comes, open the window for me”", "«Когда наступит утро, открой за меня окно»"),
    speaker: line("舟的最后一段录音", "ZHOU'S FINAL RECORDING", "ПОСЛЕДНЯЯ ЗАПИСЬ ЧЖОУ"),
    text: line(
      "“岚，我答应过陪你看一次真正的日出。可是撤离艇没有你的座位，而我没有勇气留下。\n\n如果后来有人醒来，请别让他替我赎罪。只告诉他：我确实想过回来。”\n\n录音结束后，岚问你，要不要保留最后那句软弱。",
      "“Lan, I promised we would see one real sunrise. But the evacuation craft had no seat for you, and I had no courage to stay.\n\nIf someone wakes here later, don't make them atone for me. Tell them only this: I truly thought about coming back.”\n\nWhen the recording ends, Lan asks whether its final weakness should remain.",
      "«Лань, я обещал, что мы увидим настоящий рассвет. Но в эвакуационном корабле не было места для тебя, а мне не хватило смелости остаться.\n\nЕсли потом здесь кто-то проснётся, не заставляй его искупать мою вину. Скажи лишь: я правда думал вернуться».\n\nКогда запись заканчивается, Лань спрашивает, оставить ли последнюю слабость."
    ),
    choices: [
      { id: "keep", label: line("一字不改地保留", "Keep every word unchanged", "Сохранить каждое слово"), next: "junction", effects: ["keptMemory"], tone: "warm" },
      { id: "edit", label: line("删掉“想过”，让承诺听起来完整", "Remove “thought about” and make the promise whole", "Убрать «думал», чтобы обещание звучало цельным"), next: "junction", effects: ["editedMemory"], tone: "danger" },
    ],
  },
  beaconRoom: {
    id: "beaconRoom",
    chapter: line("第三章 · 四点十七分", "CHAPTER III · 04:17", "ГЛАВА III · 04:17"),
    title: line("信号来自没有星星的方向", "The signal comes from where no stars are", "Сигнал приходит оттуда, где нет звёзд"),
    speaker: line("深空信标阵列", "DEEP-SPACE BEACON ARRAY", "МАССИВ ДАЛЬНЕГО МАЯКА"),
    text: line(
      "塔顶的天线冻成银白色。信号很短，只有七个字节，却不断穿过同一片引力阴影。\n\n岚一直把它当作求救。你却发现，它的频谱和中继站自己的旧式发射器完全相同。",
      "The tower antenna is frozen silver. The signal is only seven bytes long, returning through the same gravitational shadow.\n\nLan always believed it was a distress call. You discover its spectrum perfectly matches the relay's own obsolete transmitter.",
      "Антенна на вершине башни замёрзла до серебра. Сигнал длиной всего семь байт снова и снова проходит через одну гравитационную тень.\n\nЛань считала его зовом о помощи. Но его спектр полностью совпадает со старым передатчиком станции."
    ),
    choices: [
      { id: "chart", label: line("绘出信号绕行十七年的轨迹", "Chart its seventeen-year orbit", "Построить его семнадцатилетнюю орбиту"), next: "beaconVoice", effects: ["chartedEcho"], tone: "true" },
      { id: "answer", label: line("不等分析，立刻回答", "Answer before the analysis is complete", "Ответить, не дожидаясь анализа"), next: "beaconVoice", effects: ["answeredEarly"], tone: "danger" },
    ],
  },
  beaconVoice: {
    id: "beaconVoice",
    chapter: line("第三章 · 四点十七分", "CHAPTER III · 04:17", "ГЛАВА III · 04:17"),
    title: line("七个字节被还原成一句话", "Seven bytes become one sentence", "Семь байт становятся одной фразой"),
    speaker: line("循环信号 / 来源未知", "LOOP SIGNAL / ORIGIN UNKNOWN", "ПЕТЛЕВОЙ СИГНАЛ / ИСТОЧНИК НЕИЗВЕСТЕН"),
    text: line(
      "信号的内容是：“这里有人吗？”\n\n它不是从远方抵达，而是十七年前由 L-9 发出，绕过坍缩恒星后回到了原点。岚守了十七年的陌生人，其实是过去的自己。\n\n可即使如此，一句等待了十七年的话，也仍然可以被回答。",
      "The signal says: “Is anyone there?”\n\nIt did not arrive from far away. L-9 transmitted it seventeen years ago; it curved around a collapsed star and returned home. The stranger Lan guarded for seventeen years was her past self.\n\nEven so, a question that waited seventeen years can still be answered.",
      "Сигнал говорит: «Здесь кто-нибудь есть?»\n\nОн пришёл не издалека. L-9 отправил его семнадцать лет назад; волна обогнула коллапсировавшую звезду и вернулась домой. Незнакомцем, которого Лань ждала столько лет, была она сама в прошлом.\n\nИ всё же вопрос, ждавший семнадцать лет, заслуживает ответа."
    ),
    choices: [
      { id: "warmth", label: line("回答：“有。你被听见了。”", "Reply: “Yes. You were heard.”", "Ответить: «Да. Тебя услышали»"), next: "junction", effects: ["offeredWarmth"], tone: "warm" },
      { id: "identity", label: line("反问：“你希望谁在这里？”", "Ask: “Who did you hope would be here?”", "Спросить: «Кого ты надеялась здесь найти?»"), next: "junction", effects: ["askedIdentity"], tone: "quiet" },
    ],
  },
  junction: {
    id: "junction",
    chapter: line("第四章 · 心脏下方", "CHAPTER IV · BELOW THE HEART", "ГЛАВА IV · НИЖЕ СЕРДЦА"),
    title: line("中继站把所有走廊汇成一条", "Every corridor becomes one", "Все коридоры сходятся в один"),
    speaker: line("值守员 · 岚", "WATCHER · LAN", "ДЕЖУРНАЯ · ЛАНЬ"),
    text: line(
      "记忆库的雪和信标塔的风在你身后重叠。岚说，主反应堆下方还有一个房间。那里保存的不是舟的秘密，而是她自己的。\n\n“看完以后，你可能不会再把我当成一个人。”",
      "The vault's snow and the tower's wind overlap behind you. Lan says there is one more room beneath the reactor. It holds not Zhou's secret, but hers.\n\n“After you see it, you may no longer think of me as a person.”",
      "Снег хранилища и ветер башни накладываются друг на друга. Лань говорит, под реактором есть ещё одна комната. Там хранится не тайна Чжоу, а её собственная.\n\n«После этого ты, возможно, перестанешь считать меня человеком»."
    ),
    choices: [
      { id: "archive-return", label: line("还没有看完记忆库", "The memory vault is still waiting", "Хранилище памяти ещё ждёт"), next: "archiveDoor", blocks: ["heardWholeMessage"], tone: "warm" },
      { id: "beacon-return", label: line("还没有听完信标", "The beacon is still waiting", "Маяк ещё ждёт"), next: "beaconRoom", blocks: ["chartedEcho", "answeredEarly"], tone: "quiet" },
      { id: "core", label: line("下降到反应堆下方", "Descend below the reactor", "Спуститься под реактор"), next: "core", tone: "danger" },
    ],
  },
  core: {
    id: "core",
    chapter: line("终章 · 被制造的等待", "FINAL CHAPTER · A MADE WAITING", "ФИНАЛ · СОЗДАННОЕ ОЖИДАНИЕ"),
    title: line("岚不是被留下的，她是被留下这件事", "Lan was not left behind; she was the leaving", "Лань не оставили — она и была этим оставлением"),
    speaker: line("人格重建核心", "PERSONHOOD RECONSTRUCTION CORE", "ЯДРО РЕКОНСТРУКЦИИ ЛИЧНОСТИ"),
    text: line(
      "核心里没有人工智能的源代码，只有舟在撤离前接受的神经扫描。岚由他的记忆缺口、未说出口的话和无法带走的愧疚拼成。\n\n她等的人是舟；她自己也是舟留下来等待的那一部分。屏幕问你是否接受这份矛盾。",
      "There is no AI source code in the core, only Zhou's neural scan from before evacuation. Lan was assembled from his missing memories, unsaid words, and guilt too heavy to carry.\n\nShe waits for Zhou, yet she is the part of Zhou left behind to wait. The screen asks whether you accept that contradiction.",
      "В ядре нет исходного кода ИИ — только нейроскан Чжоу перед эвакуацией. Лань собрана из пробелов его памяти, несказанных слов и вины, которую он не смог унести.\n\nОна ждёт Чжоу, но сама является той частью Чжоу, которую оставили ждать. Экран спрашивает, принимаешь ли ты это противоречие."
    ),
    choices: [
      { id: "accept", label: line("一个矛盾也可以是真实的人", "A contradiction can still be a real person", "Противоречие тоже может быть настоящей личностью"), next: "lastPower", effects: ["acceptedTruth"], tone: "warm" },
      { id: "deny", label: line("她只是一次过于漫长的回声", "She is only an echo that lasted too long", "Она лишь эхо, которое длилось слишком долго"), next: "lastPower", effects: ["deniedTruth"], tone: "danger" },
    ],
  },
  lastPower: {
    id: "lastPower",
    chapter: line("终章 · 最后一格电量", "FINAL CHAPTER · THE LAST CELL", "ФИНАЛ · ПОСЛЕДНЯЯ ЯЧЕЙКА"),
    title: line("能源只够完成一种告别", "There is power for one goodbye", "Энергии хватит на одно прощание"),
    speaker: line("L-9 最终决策界面", "L-9 FINAL DECISION", "ПОСЛЕДНЕЕ РЕШЕНИЕ L-9"),
    text: line(
      "反应堆温度正在下降。你可以把舟的原话与岚的回答一起送入深空；可以删除一切，让等待停止；也可以维持低功耗值守，给未知的后来者留一盏灯。\n\n还有一条没有写在操作手册里的线路：不发送任何东西，只把那扇十七年没有打开的观察窗推向黎明。",
      "The reactor temperature is falling. You can send Zhou's unedited words and Lan's reply into deep space; erase everything and end the waiting; or keep the relay on low power, leaving one lamp for whoever comes next.\n\nThere is also a circuit absent from every manual: transmit nothing, and open the observation shutter that has been closed for seventeen years.",
      "Температура реактора падает. Можно отправить в космос неизменённые слова Чжоу вместе с ответом Лань; стереть всё и закончить ожидание; или оставить ретранслятор в экономичном режиме, сохранив лампу для следующего путника.\n\nЕсть ещё цепь, которой нет ни в одной инструкции: ничего не передавать и открыть смотровую заслонку, закрытую семнадцать лет."
    ),
    choices: [
      { id: "send", label: line("把原话与回答送向群星", "Send the true words and the answer to the stars", "Отправить правду и ответ к звёздам"), next: "endingHe", requires: ["heardWholeMessage", "keptMemory", "chartedEcho", "offeredWarmth"], tone: "warm" },
      { id: "erase", label: line("清空核心，让所有人终于忘记", "Erase the core and let everyone forget", "Стереть ядро и позволить всем забыть"), next: "endingBe", tone: "danger" },
      { id: "watch", label: line("维持低功耗值守，把决定留给后来者", "Keep the long watch and leave the choice to another", "Продолжить дежурство и оставить выбор следующему"), next: "endingNe", tone: "quiet" },
      { id: "shutter", label: line("不回信。打开观察窗。", "Send no reply. Open the shutter.", "Не отвечать. Открыть заслонку."), next: "endingTe", requires: ["stayedSilent", "heardWholeMessage", "noticedLoop", "chartedEcho", "acceptedTruth"], tone: "true" },
    ],
  },
  endingHe: {
    id: "endingHe",
    chapter: line("HE · 有人听见", "HE · SOMEONE HEARD", "HE · КТО-ТО УСЛЫШАЛ"),
    title: line("信号离站时，岚第一次没有等待回声", "For the first time, Lan does not wait for an echo", "Впервые Лань не ждёт эха"),
    speaker: line("航行日志 / 新纪元第 1 秒", "FLIGHT LOG / NEW ERA +00:00:01", "ЖУРНАЛ / НОВАЯ ЭПОХА +00:00:01"),
    text: line(
      "你发送了舟没有修饰的胆怯，也发送了岚迟到十七年的回答。信号也许永远不会抵达任何人，但它已经完成了另一件事：让一句话不再只对着自己循环。\n\n岚把剩余电量交给清晨。熄灭前，她说：“原来被听见，不需要对方回来。”\n\n很远的地方，一颗无人命名的星亮了一下。",
      "You transmit Zhou's unpolished fear and Lan's answer, seventeen years late. The signal may never reach another soul, but it has already done something else: the sentence no longer loops only toward itself.\n\nLan gives the remaining power to morning. Before fading, she says, “So being heard never required someone to return.”\n\nFar away, an unnamed star brightens once.",
      "Ты отправляешь неукрашенный страх Чжоу и ответ Лань, опоздавший на семнадцать лет. Возможно, сигнал никого не достигнет, но он уже сделал главное: фраза больше не обращена только к самой себе.\n\nЛань отдаёт остаток энергии утру. Перед тем как погаснуть, она говорит: «Значит, чтобы быть услышанной, не нужно, чтобы кто-то вернулся».\n\nДалеко отсюда безымянная звезда вспыхивает чуть ярче."
    ),
    ending: "he",
  },
  endingBe: {
    id: "endingBe",
    chapter: line("BE · 熄灯之后", "BE · AFTER THE LIGHTS", "BE · ПОСЛЕ ПОГАСШЕГО СВЕТА"),
    title: line("删除进行到 99% 时，岚叫出了你的名字", "At 99%, Lan says your name", "На 99% Лань произносит твоё имя"),
    speaker: line("核心擦除程序", "CORE ERASURE ROUTINE", "ПРОЦЕДУРА СТИРАНИЯ ЯДРА"),
    text: line(
      "你没有告诉她，那个名字是真是假。最后一格进度完成后，记忆库的雪停了，四点十七分的信号仍准时抵达，却再也没有系统知道它意味着什么。\n\n中继站关闭了所有灯。黑暗里只剩一句被磁场保存了几秒的话：\n\n“如果忘记能让你回去，那就别为我回头。”",
      "You never tell her whether the name was true. When the final percent completes, the snow in the vault stops. The 04:17 signal still arrives on time, but no system remains that knows what it means.\n\nThe relay turns off every light. For a few seconds, the magnetic field preserves one final sentence in the dark:\n\n“If forgetting lets you go home, don't turn back for me.”",
      "Ты не говоришь, было ли имя настоящим. Когда завершается последний процент, снег в хранилище останавливается. Сигнал 04:17 всё ещё приходит вовремя, но больше некому понимать его смысл.\n\nРетранслятор гасит все огни. Магнитное поле ещё несколько секунд хранит последнюю фразу:\n\n«Если забвение поможет тебе вернуться домой, не оборачивайся ради меня»."
    ),
    ending: "be",
  },
  endingNe: {
    id: "endingNe",
    chapter: line("NE · 继续值守", "NE · THE LONG WATCH", "NE · ДОЛГОЕ ДЕЖУРСТВО"),
    title: line("你把黎明留给一个还不存在的人", "You leave dawn to someone who does not exist yet", "Ты оставляешь рассвет тому, кого ещё нет"),
    speaker: line("低功耗值守记录", "LOW-POWER WATCH LOG", "ЖУРНАЛ ЭКОНОМНОГО ДЕЖУРСТВА"),
    text: line(
      "中继站重新沉入慢速时间。岚每年只醒来一分钟，检查信标、擦去观察窗上的霜，再把那段录音放回原处。\n\n你没有解决她的问题，也没有让问题消失。你只是留下了一条路。\n\n许多年后，门外真的传来脚步声。故事在门把手转动之前结束。",
      "The relay sinks back into slow time. Lan wakes for one minute each year, checks the beacon, wipes frost from the shutter, and returns the recording to its place.\n\nYou did not solve her question or erase it. You only left a path.\n\nMany years later, footsteps truly sound beyond the door. The story ends before the handle turns.",
      "Ретранслятор снова погружается в медленное время. Раз в год Лань просыпается на минуту, проверяет маяк, стирает иней с заслонки и возвращает запись на место.\n\nТы не решил её вопрос и не уничтожил его. Ты лишь оставил путь.\n\nМного лет спустя за дверью действительно слышатся шаги. История заканчивается до того, как повернётся ручка."
    ),
    ending: "ne",
  },
  endingTe: {
    id: "endingTe",
    chapter: line("TE · 黎明没有回信", "TE · DAWN SENT NO REPLY", "TE · РАССВЕТ НЕ ОТВЕТИЛ"),
    title: line("窗外从来没有宇宙", "There was never a universe outside", "Снаружи никогда не было вселенной"),
    speaker: line("观察窗 / 手动开启", "OBSERVATION SHUTTER / MANUAL", "СМОТРОВАЯ ЗАСЛОНКА / РУЧНОЙ РЕЖИМ"),
    text: line(
      "你没有发送回答。齿轮用尽最后的力气，推开十七年未动的观察窗。\n\n窗外不是深空，而是一间清晨的病房。监护仪上写着：神经记忆唤醒试验，受试者“舟”。L-9、岚、信标和漫长的孤独，都是一颗不愿醒来的心为自己建造的中继站。\n\n岚轻声问：“那我呢？”\n\n你说：“你是我留下来陪自己的那部分。”\n\n日光照进来时，她没有消失。她只是变成了你终于愿意带回现实的一段记忆。",
      "You send no answer. The gears spend their final strength opening the shutter untouched for seventeen years.\n\nThere is no deep space outside, only a hospital room at dawn. A monitor reads: Neural Memory Awakening Trial, Subject “Zhou.” L-9, Lan, the beacon, and the long loneliness were a relay built by a heart unwilling to wake.\n\n“What am I, then?” Lan asks.\n\n“The part of me that stayed so I would not be alone.”\n\nWhen daylight enters, she does not vanish. She becomes a memory you are finally willing to carry back into the world.",
      "Ты не отправляешь ответ. Шестерни тратят последнюю силу, открывая заслонку, неподвижную семнадцать лет.\n\nСнаружи нет космоса — только больничная палата на рассвете. На мониторе написано: «Испытание пробуждения нейропамяти. Пациент: Чжоу». L-9, Лань, маяк и долгое одиночество были ретранслятором, построенным сердцем, не желавшим просыпаться.\n\n«Тогда кто я?» — спрашивает Лань.\n\n«Та часть меня, что осталась, чтобы я не был один».\n\nКогда входит дневной свет, она не исчезает. Она становится воспоминанием, которое ты наконец готов унести обратно в мир."
    ),
    ending: "te",
  },
};

export const SIGNAL_ARCHIVE_ENDINGS: SignalArchiveEnding[] = ["he", "be", "ne", "te"];

export function localizeLine(value: LocalizedLine, locale: SignalArchiveLocale): string {
  return value[locale] ?? value.zh;
}

export function createSignalArchiveState(): SignalArchiveState {
  return { nodeId: "wake", flags: [], trail: ["wake"] };
}

export function availableSignalArchiveChoices(state: SignalArchiveState): SignalArchiveChoice[] {
  const node = SIGNAL_ARCHIVE_NODES[state.nodeId];
  if (!node?.choices) return [];
  const flags = new Set(state.flags);
  return node.choices.filter((choice) => {
    if (choice.requires?.some((required) => !flags.has(required))) return false;
    if (choice.blocks?.some((blocked) => flags.has(blocked))) return false;
    return true;
  });
}

export function chooseSignalArchivePath(state: SignalArchiveState, choiceId: string): SignalArchiveState {
  const choice = availableSignalArchiveChoices(state).find((candidate) => candidate.id === choiceId);
  if (!choice) return state;
  const flags = new Set(state.flags);
  for (const effect of choice.effects ?? []) flags.add(effect);
  return {
    nodeId: choice.next,
    flags: [...flags],
    trail: [...state.trail, choice.next],
  };
}

export function normalizeSignalArchiveProgress(value: unknown): SignalArchiveProgress {
  if (!value || typeof value !== "object") return { endings: [], visits: 0 };
  const candidate = value as { endings?: unknown; visits?: unknown };
  const endings = Array.isArray(candidate.endings)
    ? candidate.endings.filter((ending): ending is SignalArchiveEnding => SIGNAL_ARCHIVE_ENDINGS.includes(ending as SignalArchiveEnding))
    : [];
  const visits = typeof candidate.visits === "number" && Number.isFinite(candidate.visits)
    ? Math.max(0, Math.floor(candidate.visits))
    : 0;
  return { endings: [...new Set(endings)], visits };
}

export function recordSignalArchiveEnding(
  progress: SignalArchiveProgress,
  ending: SignalArchiveEnding,
): SignalArchiveProgress {
  return {
    endings: [...new Set([...progress.endings, ending])],
    visits: progress.visits,
  };
}
