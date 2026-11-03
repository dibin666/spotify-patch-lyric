/*
 * Spot-Lyric core — JavaScript port of spot-lyric (src/match.c, src/model.c,
 * src/providers.c, src/http.c, src/engine.c).  Pure logic: no DOM access.
 * Network, storage and Spotify access are injected so the same engine runs
 * inside the Spotify renderer and under the Node test-suite.
 *
 * Matching follows the approach of mature lyric tools (Lyricify Lyrics Helper,
 * LDDC, lyrics-plus): Traditional/Simplified folding, version-tag aware titles,
 * multi-artist / CV-alias aware artists, graded duration, missing fields
 * re-weighted, and a widening query cascade.
 */
(function (root) {
  'use strict';

  const DURATION_TOLERANCE = 3000;
  /* Bumped when the stored lyrics format changes (v3: translation merge skips blank lines). */
  const LYRICS_CACHE = 'lyrics4', TRACK_CACHE = 'tracklyrics4:', NEGATIVE = 'negative2:';
  const MAX_RESPONSE = 2 * 1024 * 1024;
  const PROVIDERS = ['netease', 'qq'];
  const PROVIDER_NAMES = { netease: '网易云音乐', qq: 'QQ 音乐', spotify: 'Spotify', local: '本地文件' };

  /* ------------------------------------------------------------ text ---- */
  /* Traditional -> Simplified, generated from OpenCC (master) by
   * tools/gen-t2s.mjs: TSCharacters plus TWVariants / HKVariants /
   * JPShinjitai / CJK compatibility ideographs chained through it
   * (桜→櫻→樱, 豈→豈). Spotify often ships Taiwanese / HK metadata
   * (「周杰倫」「說好的幸福呢」) while NetEase / QQ use simplified
   * Chinese. Character-level fold with OpenCC's first candidate; both
   * sides go through normalize(), so consistent loss still matches. */
  const T2S_FROM = "㑯㑳㑶㓨㘚㜄㜏㠏㥮㩜㩳㩵䁻䃮䊷䋙䋚䋹䋻䍦䎱䙡䜀䝼䥇䥑䥱䦛䦟䯀䰾䱷䱽䲁䲘䴉丟並乾亂亙亞佇佈佔併來侖侶侷俁係俔俠俥俬倀倆倈倉個們倖倫倲偉偑側偵偽傌傑傖傘備傢傭傯傳傴債傷傾僂僅僉僑僕僞僥僨僱價儀儁儂億儈儉儎儐儔儕儘償優儲儷儸儺儻儼兇兌兒兗內兩冊冑冪凈凍凜凱別刪剄則剋剎剗剛剝剮剴創剷劃劄劇劉劊劌劍劏劑劚勁動務勛勝勞勢勩勱勳勵勸勻匭匯匱區協卹卻卽厙厠厤厭厲厴參叄叢吒吳吶呂咼員唄唸問啓啞啟啢喎喚喪喫喬單喲嗆嗇嗊嗎嗚嗩嗶嘆嘍嘓嘔嘖嘗嘜嘩嘮嘯嘰嘵嘸嘽噁噓噚噝噠噥噦噯噲噴噸噹嚀嚇嚌嚐嚕嚙嚥嚦嚨嚮嚲嚳嚴嚶囀囁囂囅囈囉囌囑囪圇國圍園圓圖團垻埡埰執堅堊堖堝堯報場塊塋塏塒塗塚塢塤塵塹墊墜墮墰墳墶墻墾壇壋壎壓壘壙壚壜壞壟壠壢壩壪壯壺壼壽夠夢夥夾奐奧奩奪奬奮奼妝姍姦娛婁婦婭媧媯媰媼媽嫋嫗嫵嫺嫻嫿嬀嬃嬈嬋嬌嬙嬡嬤嬪嬰嬸孃孋孌孫學孿宮寀寢實寧審寫寬寵寶將專尋對導尷屆屍屓屜屢層屨屬岡峯峴島峽崍崑崗崙崢崬嵐嵗嵾嶁嶄嶇嶔嶗嶠嶢嶧嶨嶮嶸嶺嶼嶽巋巒巔巖巰巹帥師帳帶幀幃幓幗幘幟幣幫幬幷幹幾庫廁廂廄廈廎廕廚廝廟廠廡廢廣廩廬廳弒弔弳張強彆彈彌彎彔彙彠彥彫彲彿後徑從徠復徵徹恆恥悅悞悵悶悽惡惱惲惻愛愜愨愴愷愾慄態慍慘慚慟慣慤慪慫慮慳慶慺慼慾憂憊憐憑憒憖憚憤憫憮憲憶懇應懌懍懞懟懣懤懨懲懶懷懸懺懼懾戀戇戔戧戩戰戱戲戶扞拋拚挩挱挾捨捫捱捲掃掄掆掗掙掛採揀揚換揮揯損搖搗搧搵搶摑摜摟摯摳摶摺摻撈撏撐撓撝撟撣撥撫撲撳撻撾撿擁擄擇擊擋擓擔據擠擡擣擬擯擰擱擲擴擷擺擻擼擽擾攄攆攏攔攖攙攛攜攝攢攣攤攪攬敎敓敗敘敵數斂斃斆斕斬斷於旂旣昇時晉晝暈暉暘暢暫曄曆曇曉曏曖曠曨曬書會朧朮東枴柵柺査桿梔梘條梟梲棄棊棖棗棟棡棧棲棶椏椲楊楓楨業極榘榦榪榮榲榿構槍槓槤槧槨槮槳槶槼樁樂樅樑樓標樞樢樣樧樫樳樸樹樺樿橈橋機橢橫檁檉檔檜檟檢檣檮檯檳檸檻櫃櫓櫚櫛櫝櫞櫟櫥櫧櫨櫪櫫櫬櫱櫳櫸櫻欄欅權欏欒欖欞欽歎歐歟歡歲歷歸歿殘殞殤殨殫殭殮殯殰殲殺殻殼毀毆毿氂氈氌氣氫氬氳氾汎汙決沒沖況泝洩洶浹涇涗涼淒淚淥淨淩淪淵淶淺渙減渢渦測渾湊湞湧湯溈準溝溫溮溳溼滄滅滌滎滙滬滯滲滷滸滻滾滿漁漊漚漢漣漬漲漵漸漿潁潑潔潙潚潛潤潯潰潷潿澀澆澇澐澗澠澤澦澩澮澱澾濁濃濄濕濘濚濛濜濟濤濧濫濰濱濺濼濾瀂瀅瀆瀇瀉瀋瀏瀕瀘瀝瀟瀠瀦瀧瀨瀰瀲瀾灃灄灑灕灘灝灡灣灤灧灩災為烏烴無煉煒煙煢煥煩煬煱熅熒熗熱熲熾燁燈燉燒燙燜營燦燬燭燴燶燻燼燾爍爐爛爭爲爺爾牀牆牘牴牽犖犛犢犧狀狹狽猙猶猻獁獃獄獅獎獨獪獫獮獰獱獲獵獷獸獺獻獼玀現琱琺琿瑋瑒瑣瑤瑩瑪瑲璉璡璣璦璫璯環璵璸璽璿瓊瓏瓔瓚甌甕產産畝畢畫異畵當疇疊痙痠痾瘂瘋瘍瘓瘞瘡瘧瘮瘲瘺瘻療癆癇癉癒癘癟癡癢癤癥癧癩癬癭癮癰癱癲發皁皚皰皸皺盃盜盞盡監盤盧盪眞眥眾睏睜睞瞘瞜瞞瞶瞼矇矓矚矯硃硜硤硨硯碕碩碭碸確碼碽磑磚磠磣磧磯磽磾礄礎礙礦礪礫礬礱祕祿禍禎禕禡禦禪禮禰禱禿秈稅稈稏稜稟種稱穀穇穌積穎穠穡穢穩穫穭窩窪窮窯窵窶窺竄竅竇竈竊竪競筆筍筧筴箇箋箏箚節範築篋篔篠篤篩篳簀簍簑簞簡簣簫簹簽簾籃籌籔籙籛籜籟籠籤籩籪籬籮籲粵糉糝糞糧糰糲糴糶糹糾紀紂約紅紆紇紈紉紋納紐紓純紕紖紗紘紙級紛紜紝紡紬紮細紱紲紳紵紹紺紼紿絀終絃組絅絆絎結絕絛絝絞絡絢給絨絰統絲絳絶絹綁綃綆綈綉綌綏綐綑經綜綞綠綢綣綫綬維綯綰綱網綳綴綵綸綹綺綻綽綾綿緄緇緊緋緑緒緓緔緗緘緙線緝緞締緡緣緦編緩緬緯緱緲練緶緹緻緼縈縉縊縋縐縑縕縗縛縝縞縟縣縧縫縭縮縱縲縳縴縵縶縷縹總績繃繅繆繒織繕繚繞繡繢繩繪繫繭繮繯繰繳繸繹繼繽繾繿纇纈纊續纍纏纓纔纖纘纜缽罃罈罌罎罰罵罷羅羆羈羋羣羥羨義羶習翫翬翹翽耬耮聖聞聯聰聲聳聵聶職聹聽聾肅脅脈脛脣脩脫脹腎腖腡腦腫腳腸膃膕膚膞膠膩膽膾膿臉臍臏臘臚臟臠臢臥臨臺與興舉舊舖舘艙艤艦艫艱艷芻苧茲荊莊莖莢莧華菴菸萇萊萬萴萵葉葒葤葦葯葷蒐蒓蒔蒕蒞蒼蓀蓆蓋蓮蓯蓴蓽蔔蔘蔞蔣蔥蔦蔭蕁蕆蕎蕒蕓蕕蕘蕢蕩蕪蕭蕷薀薈薊薌薑薔薘薟薦薩薴薵薹薺藍藎藝藥藪藭藴藶藹藺蘀蘄蘆蘇蘊蘋蘚蘞蘢蘭蘺蘿虆處虛虜號虧虯蛺蛻蜆蝕蝟蝦蝨蝸螄螞螢螮螻螿蟄蟈蟎蟣蟬蟯蟲蟶蟻蠁蠅蠆蠍蠐蠑蠔蠟蠣蠨蠱蠶蠻衆衊術衕衚衛衝袞袷裊裏補裝裡製複褌褘褲褳褸褻襇襉襏襖襝襠襤襪襬襯襲襴覈見覎規覓視覘覡覥覦親覬覯覲覷覺覽覿觀觴觶觸訁訂訃計訊訌討訐訒訓訕訖託記訛訝訟訢訣訥訩訪設許訴訶診註証詁詆詎詐詒詔評詖詗詘詛詞詠詡詢詣試詩詫詬詭詮詰話該詳詵詼詿誄誅誆誇誌認誑誒誕誘誚語誠誡誣誤誥誦誨說説誰課誶誹誼誾調諂諄談諉請諍諏諑諒論諗諛諜諝諞諡諢諤諦諧諫諭諮諱諳諶諷諸諺諼諾謀謁謂謄謅謊謎謐謔謖謗謙謚講謝謠謡謨謫謬謭謳謹謾譁證譎譏譖識譙譚譜譟譫譭譯議譴護譸譽譾讀讅變讋讌讎讒讓讕讖讚讜讞谿豈豎豐豔豬豶貍貓貙貝貞貟負財貢貧貨販貪貫責貯貰貲貳貴貶買貸貺費貼貽貿賀賁賂賃賄賅資賈賊賑賒賓賕賙賚賜賞賠賡賢賣賤賦賧質賫賬賭賰賴賵賺賻購賽賾贄贅贇贈贊贋贍贏贐贓贔贖贗贛贜赬趕趙趨趲跡踐踰踴蹌蹕蹟蹠蹣蹤蹺躂躉躊躋躍躎躑躒躓躕躚躡躥躦躪軀車軋軌軍軑軒軔軛軟軤軫軲軸軹軺軻軼軾較輅輇輈載輊輒輓輔輕輛輜輝輞輟輥輦輩輪輬輯輳輸輻輼輾輿轀轂轄轅轆轉轍轎轔轟轡轢轤辦辭辮辯農迴逕這連週進遊運過達違遙遜遞遠遡適遲遶遷選遺遼邁還邇邊邏邐郟郵鄆鄉鄒鄔鄖鄧鄭鄰鄲鄴鄶鄺酇酈醃醖醜醞醟醣醫醬醱釀釁釃釅釋釐釒釓釔釕釗釘釙針釣釤釦釧釩釵釷釹釺釾鈀鈁鈃鈄鈅鈈鈉鈍鈎鈐鈑鈒鈔鈕鈞鈡鈣鈥鈦鈧鈮鈰鈳鈴鈷鈸鈹鈺鈽鈾鈿鉀鉅鉆鉈鉉鉋鉍鉑鉕鉗鉚鉛鉞鉢鉤鉦鉬鉭鉳鉶鉸鉺鉻鉿銀銃銅銍銑銓銖銘銚銛銜銠銣銥銦銨銩銪銫銬銱銳銷銹銻銼鋁鋃鋅鋇鋌鋏鋒鋙鋝鋟鋣鋤鋥鋦鋨鋩鋪鋭鋮鋯鋰鋱鋶鋸鋼錁錄錆錇錈錏錐錒錕錘錙錚錛錟錠錡錢錦錨錩錫錮錯録錳錶錸錼鍀鍁鍃鍅鍆鍇鍈鍊鍋鍍鍔鍘鍚鍛鍠鍤鍥鍩鍬鍰鍵鍶鍺鍼鍾鎂鎄鎇鎊鎌鎔鎖鎘鎚鎛鎡鎢鎣鎦鎧鎩鎪鎬鎭鎮鎰鎲鎳鎵鎶鎸鎿鏃鏇鏈鏌鏍鏐鏑鏗鏘鏜鏝鏞鏟鏡鏢鏤鏨鏰鏵鏷鏹鏺鏽鐃鐋鐐鐒鐓鐔鐘鐙鐝鐠鐥鐦鐧鐨鐫鐮鐯鐲鐳鐵鐶鐸鐺鐿鑄鑊鑌鑑鑒鑔鑕鑞鑠鑣鑥鑭鑰鑱鑲鑷鑹鑼鑽鑾鑿钁钂長門閂閃閆閈閉開閌閎閏閑閒間閔閘閡閣閤閥閨閩閫閬閭閱閲閶閹閻閼閽閾閿闃闆闇闈闊闋闌闍闐闒闓闔闕闖關闞闠闡闢闤闥陘陝陞陣陰陳陸陽隉隊階隕際隨險隯隱隴隸隻雋雖雙雛雜雞離難雲電霑霢霧霽靂靄靆靈靉靚靜靝靦靨鞏鞝鞦鞽韁韃韆韉韋韌韍韓韙韜韝韞韻響頁頂頃項順頇須頊頌頎頏預頑頒頓頗領頜頡頤頦頭頮頰頲頴頷頸頹頻頽顆題額顎顏顒顓顔願顙顛類顢顥顧顫顬顯顰顱顳顴風颭颮颯颱颳颶颸颺颻颼飀飄飆飈飛飠飢飣飥飩飪飫飭飯飱飲飴飼飽飾飿餃餄餅餈餉養餌餎餏餑餒餓餕餖餘餚餛餜餞餡館餬餱餳餵餶餷餺餼餾餿饁饃饅饈饉饊饋饌饑饒饗饜饞饢馬馭馮馱馳馴馹駁駐駑駒駔駕駘駙駛駝駟駡駢駭駰駱駸駿騁騂騅騌騍騎騏騖騙騤騧騫騭騮騰騶騷騸騾驀驁驂驃驄驅驊驌驍驏驕驗驚驛驟驢驤驥驦驪驫骯髏髒體髕髖髮鬆鬍鬚鬢鬥鬧鬨鬩鬮鬱鬹魎魘魚魛魢魨魯魴魷魺鮁鮃鮊鮋鮍鮎鮐鮑鮒鮓鮚鮜鮝鮞鮣鮦鮪鮫鮭鮮鮳鮶鮺鯀鯁鯇鯉鯊鯒鯔鯕鯖鯗鯛鯝鯡鯢鯤鯧鯨鯪鯫鯰鯴鯷鯽鯿鰁鰂鰃鰆鰈鰉鰌鰍鰏鰐鰒鰓鰛鰜鰟鰠鰣鰥鰧鰨鰩鰭鰮鰱鰲鰳鰵鰷鰹鰺鰻鰼鰾鱂鱅鱈鱉鱒鱔鱖鱗鱘鱝鱟鱠鱣鱤鱧鱨鱭鱯鱷鱸鱺鳥鳧鳩鳬鳲鳳鳴鳶鳾鴆鴇鴉鴒鴕鴛鴝鴞鴟鴣鴦鴨鴯鴰鴴鴷鴻鴿鵁鵂鵃鵐鵑鵒鵓鵜鵝鵠鵡鵪鵬鵮鵯鵰鵲鵷鵾鶄鶇鶉鶊鶓鶖鶘鶚鶡鶥鶩鶪鶬鶯鶲鶴鶹鶺鶻鶼鶿鷀鷁鷂鷄鷉鷊鷓鷖鷗鷙鷚鷥鷦鷫鷯鷲鷳鷴鷸鷹鷺鷽鸂鸇鸊鸌鸏鸕鸘鸚鸛鸝鸞鹵鹹鹺鹼鹽麗麥麩麪麫麯麴麵麼麽黃黌點黨黲黴黶黷黽黿鼂鼉鼕鼴齊齋齎齏齒齔齕齗齙齜齟齠齡齣齦齧齪齬齲齶齷龍龎龐龑龔龕龜鿁鿓幺檐潨痹着睾蔿両乗亀予亜仏仮伝価倹児円処剣剤剰労効勅勧勲単厳収叙唖営噛団囲図圏圧塁塩増壊壌壱売変奨嬢実寛対専尭巌巣巻帯帰庁広廃弁弐弾従徳徴応恵悩悪慎懐戦戯戻払抜択拝拠拡挙挿捜掲掻揺摂撃撹斉斎晃晩暁暦曽栄桜桝桟検楽概様槙権欠歓歩歯歳歴毎気沢沪浄浜涙渇済渉渋渓満滝瀬焼犠猟獣瓶畳痩発県研砕稲穂穏穣竜粋粛糸経絵継続総縁縄縦繊繍缶翻聴脳臓艶芸荘萌蔵薫薬蛍蝋褒覇覚覧観訳読譲豊賛転軽辺逓遅郎郷酔醤醸釈鉄鉱銭鋳錬関闘陥険隠雑霊頼顕駅駆騒験髄髪鴎鶏鹸麹麺黒黙齢豈更車賈滑串句龜龜契金喇奈懶癩羅蘿螺裸邏樂洛烙珞落酪駱亂卵欄爛蘭鸞嵐濫藍襤拉臘蠟廊朗浪狼郎來冷勞擄櫓爐盧老蘆虜路露魯鷺碌祿綠菉錄鹿論壟弄籠聾牢磊賂雷壘屢樓淚漏累縷陋勒肋凜凌稜綾菱陵讀拏樂諾丹寧怒率異北磻便復不泌數索參塞省葉說殺辰沈拾若掠略亮兩凉梁糧良諒量勵呂女廬旅濾礪閭驪麗黎力曆歷轢年憐戀撚漣煉璉秊練聯輦蓮連鍊列劣咽烈裂說廉念捻殮簾獵令囹寧嶺怜玲瑩羚聆鈴零靈領例禮醴隸惡了僚寮尿料樂燎療蓼遼龍暈阮劉杻柳流溜琉留硫紐類六戮陸倫崙淪輪律慄栗率隆利吏履易李梨泥理痢罹裏裡里離匿溺吝燐璘藺隣鱗麟林淋臨立笠粒狀炙識什茶刺切度拓糖宅洞暴輻行降見廓兀嗀塚晴凞猪益礼神祥福靖精羽蘒諸逸都飯飼館鶴郞隷侮僧免勉勤卑喝嘆器塀墨層屮悔慨憎懲敏既暑梅海渚漢煮爫琢碑社祉祈祐祖祝禍禎穀突節練縉繁署者臭艹艹著褐視謁謹賓贈辶逸難響頻恵舘並况全侀充冀勇勺喝啕喙嗢塚墳奄奔婢嬨廒廙彩徭惘慎愈憎慠懲戴揄搜摒敖晴朗望杖歹殺流滛滋漢瀞煮瞧爵犯猪瑱甆画瘝瘟益盛直睊着磌窱節类絛練缾者荒華蝹襁覆視調諸請謁諾諭謹變贈輸遲醙鉶陼難靖韛響頋頻鬒龜㮝䀘䀹齃龎";
  const T2S_TO = "㑔㑇㐹刾㘎㚯㛣㟆㤘㨫㧐擜䀥鿎䌶䌺䌻䌿䌾䍠䎬䙌䜧䞍䦂鿏䥾䦶䦷䯅鲃䲣䲝鳚鳤鹮丢并干乱亘亚伫布占并来仑侣局俣系伣侠伡私伥俩俫仓个们幸伦㑈伟㐽侧侦伪㐷杰伧伞备家佣偬传伛债伤倾偻仅佥侨仆伪侥偾雇价仪俊侬亿侩俭傤傧俦侪尽偿优储俪㑩傩傥俨凶兑儿兖内两册胄幂净冻凛凯别删刭则克刹刬刚剥剐剀创铲划札剧刘刽刿剑㓥剂㔉劲动务勋胜劳势勚劢勋励劝匀匦汇匮区协恤却即厍厕历厌厉厣参叁丛咤吴呐吕呙员呗念问启哑启唡㖞唤丧吃乔单哟呛啬唝吗呜唢哔叹喽啯呕啧尝唛哗唠啸叽哓呒啴恶嘘㖊咝哒哝哕嗳哙喷吨当咛吓哜尝噜啮咽呖咙向亸喾严嘤啭嗫嚣冁呓啰苏嘱囱囵国围园圆图团坝垭采执坚垩垴埚尧报场块茔垲埘涂冢坞埙尘堑垫坠堕坛坟垯墙垦坛垱埙压垒圹垆坛坏垄垅坜坝塆壮壶壸寿够梦伙夹奂奥奁夺奖奋姹妆姗奸娱娄妇娅娲妫㛀媪妈袅妪妩娴娴婳妫媭娆婵娇嫱嫒嬷嫔婴婶娘㛤娈孙学孪宫采寝实宁审写宽宠宝将专寻对导尴届尸屃屉屡层屦属冈峰岘岛峡崃昆岗仑峥岽岚岁㟥嵝崭岖嵚崂峤峣峄峃崄嵘岭屿岳岿峦巅岩巯卺帅师帐带帧帏㡎帼帻帜币帮帱并干几库厕厢厩厦庼荫厨厮庙厂庑废广廪庐厅弑吊弪张强别弹弥弯录汇彟彦雕彨佛后径从徕复征彻恒耻悦悮怅闷凄恶恼恽恻爱惬悫怆恺忾栗态愠惨惭恸惯悫怄怂虑悭庆㥪戚欲忧惫怜凭愦慭惮愤悯怃宪忆恳应怿懔蒙怼懑㤽恹惩懒怀悬忏惧慑恋戆戋戗戬战戯戏户捍抛拼捝挲挟舍扪挨卷扫抡㧏挜挣挂采拣扬换挥搄损摇捣扇揾抢掴掼搂挚抠抟折掺捞挦撑挠㧑挢掸拨抚扑揿挞挝捡拥掳择击挡㧟担据挤抬捣拟摈拧搁掷扩撷摆擞撸㧰扰摅撵拢拦撄搀撺携摄攒挛摊搅揽教敚败叙敌数敛毙敩斓斩断于旗既升时晋昼晕晖旸畅暂晔历昙晓向暧旷昽晒书会胧术东拐栅拐查杆栀枧条枭棁弃棋枨枣栋㭎栈栖梾桠㭏杨枫桢业极矩干杩荣榅桤构枪杠梿椠椁椮桨椢椝桩乐枞梁楼标枢㭤样榝㭴桪朴树桦椫桡桥机椭横檩柽档桧槚检樯梼台槟柠槛柜橹榈栉椟橼栎橱槠栌枥橥榇蘖栊榉樱栏榉权椤栾榄棂钦叹欧欤欢岁历归殁残殒殇㱮殚僵殓殡㱩歼杀壳壳毁殴毵牦毡氇气氢氩氲泛泛污决没冲况溯泄汹浃泾涚凉凄泪渌净凌沦渊涞浅涣减沨涡测浑凑浈涌汤沩准沟温浉涢湿沧灭涤荥汇沪滞渗卤浒浐滚满渔溇沤汉涟渍涨溆渐浆颍泼洁沩㴋潜润浔溃滗涠涩浇涝沄涧渑泽滪泶浍淀㳠浊浓㳡湿泞溁蒙浕济涛㳔滥潍滨溅泺滤澛滢渎㲿泻沈浏濒泸沥潇潆潴泷濑弥潋澜沣滠洒漓滩灏㳕湾滦滟滟灾为乌烃无炼炜烟茕焕烦炀㶽煴荧炝热颎炽烨灯炖烧烫焖营灿毁烛烩㶶熏烬焘烁炉烂争为爷尔床墙牍抵牵荦牦犊牺状狭狈狰犹狲犸呆狱狮奖独狯猃狝狞㺍获猎犷兽獭献猕猡现雕珐珲玮玚琐瑶莹玛玱琏琎玑瑷珰㻅环玙瑸玺璇琼珑璎瓒瓯瓮产产亩毕画异画当畴叠痉酸疴痖疯疡痪瘗疮疟瘆疭瘘瘘疗痨痫瘅愈疠瘪痴痒疖症疬癞癣瘿瘾痈瘫癫发皂皑疱皲皱杯盗盏尽监盘卢荡真眦众困睁睐眍䁖瞒瞆睑蒙眬瞩矫朱硁硖砗砚埼硕砀砜确码䂵硙砖硵碜碛矶硗䃅硚础碍矿砺砾矾砻秘禄祸祯祎祃御禅礼祢祷秃籼税秆䅉棱禀种称谷䅟稣积颖秾穑秽稳获穞窝洼穷窑窎窭窥窜窍窦灶窃竖竞笔笋笕䇲个笺筝札节范筑箧筼筿笃筛筚箦篓蓑箪简篑箫筜签帘篮筹䉤箓篯箨籁笼签笾簖篱箩吁粤粽糁粪粮团粝籴粜纟纠纪纣约红纡纥纨纫纹纳纽纾纯纰纼纱纮纸级纷纭纴纺䌷扎细绂绁绅纻绍绀绋绐绌终弦组䌹绊绗结绝绦绔绞络绚给绒绖统丝绛绝绢绑绡绠绨绣绤绥䌼捆经综缍绿绸绻线绶维绹绾纲网绷缀彩纶绺绮绽绰绫绵绲缁紧绯绿绪绬绱缃缄缂线缉缎缔缗缘缌编缓缅纬缑缈练缏缇致缊萦缙缢缒绉缣缊缞缚缜缟缛县绦缝缡缩纵缧䌸纤缦絷缕缥总绩绷缫缪缯织缮缭绕绣缋绳绘系茧缰缳缲缴䍁绎继缤缱䍀颣缬纩续累缠缨才纤缵缆钵䓨坛罂坛罚骂罢罗罴羁芈群羟羡义膻习玩翚翘翙耧耢圣闻联聪声耸聩聂职聍听聋肃胁脉胫唇修脱胀肾胨脶脑肿脚肠腽腘肤䏝胶腻胆脍脓脸脐膑腊胪脏脔臜卧临台与兴举旧铺馆舱舣舰舻艰艳刍苎兹荆庄茎荚苋华庵烟苌莱万荝莴叶荭荮苇药荤搜莼莳蒀莅苍荪席盖莲苁莼荜卜参蒌蒋葱茑荫荨蒇荞荬芸莸荛蒉荡芜萧蓣蕰荟蓟芗姜蔷荙莶荐萨苧䓓苔荠蓝荩艺药薮䓖蕴苈蔼蔺萚蕲芦苏蕴苹藓蔹茏兰蓠萝蔂处虚虏号亏虬蛱蜕蚬蚀猬虾虱蜗蛳蚂萤䗖蝼螀蛰蝈螨虮蝉蛲虫蛏蚁蚃蝇虿蝎蛴蝾蚝蜡蛎蟏蛊蚕蛮众蔑术同胡卫冲衮夹袅里补装里制复裈袆裤裢褛亵裥裥袯袄裣裆褴袜摆衬袭襕核见觃规觅视觇觋觍觎亲觊觏觐觑觉览觌观觞觯触讠订讣计讯讧讨讦讱训讪讫托记讹讶讼䜣诀讷讻访设许诉诃诊注证诂诋讵诈诒诏评诐诇诎诅词咏诩询诣试诗诧诟诡诠诘话该详诜诙诖诔诛诓夸志认诳诶诞诱诮语诚诫诬误诰诵诲说说谁课谇诽谊訚调谄谆谈诿请诤诹诼谅论谂谀谍谞谝谥诨谔谛谐谏谕咨讳谙谌讽诸谚谖诺谋谒谓誊诌谎谜谧谑谡谤谦谥讲谢谣谣谟谪谬谫讴谨谩哗证谲讥谮识谯谭谱噪谵毁译议谴护诪誉谫读谉变詟䜩雠谗让谰谶赞谠谳溪岂竖丰艳猪豮狸猫䝙贝贞贠负财贡贫货贩贪贯责贮贳赀贰贵贬买贷贶费贴贻贸贺贲赂赁贿赅资贾贼赈赊宾赇赒赉赐赏赔赓贤卖贱赋赕质赍账赌䞐赖赗赚赙购赛赜贽赘赟赠赞赝赡赢赆赃赑赎赝赣赃赪赶赵趋趱迹践逾踊跄跸迹跖蹒踪跷跶趸踌跻跃䟢踯跞踬蹰跹蹑蹿躜躏躯车轧轨军轪轩轫轭软轷轸轱轴轵轺轲轶轼较辂辁辀载轾辄挽辅轻辆辎辉辋辍辊辇辈轮辌辑辏输辐辒辗舆辒毂辖辕辘转辙轿辚轰辔轹轳办辞辫辩农回径这连周进游运过达违遥逊递远溯适迟绕迁选遗辽迈还迩边逻逦郏邮郓乡邹邬郧邓郑邻郸邺郐邝酂郦腌酝丑酝蒏糖医酱酦酿衅酾酽释厘钅钆钇钌钊钉钋针钓钐扣钏钒钗钍钕钎䥺钯钫钘钭钥钚钠钝钩钤钣钑钞钮钧钟钙钬钛钪铌铈钶铃钴钹铍钰钸铀钿钾巨钻铊铉铇铋铂钷钳铆铅钺钵钩钲钼钽锫铏铰铒铬铪银铳铜铚铣铨铢铭铫铦衔铑铷铱铟铵铥铕铯铐铞锐销锈锑锉铝锒锌钡铤铗锋铻锊锓铘锄锃锔锇铓铺锐铖锆锂铽锍锯钢锞录锖锫锩铔锥锕锟锤锱铮锛锬锭锜钱锦锚锠锡锢错录锰表铼镎锝锨锪钫钔锴锳炼锅镀锷铡钖锻锽锸锲锘锹锾键锶锗针钟镁锿镅镑镰镕锁镉锤镈镃钨蓥镏铠铩锼镐镇镇镒镋镍镓鿔镌镎镞旋链镆镙镠镝铿锵镗镘镛铲镜镖镂錾镚铧镤镪䥽锈铙铴镣铹镦镡钟镫镢镨䦅锎锏镄镌镰䦃镯镭铁镮铎铛镱铸镬镔鉴鉴镲锧镴铄镳镥镧钥镵镶镊镩锣钻銮凿镢镋长门闩闪闫闬闭开闶闳闰闲闲间闵闸阂阁合阀闺闽阃阆闾阅阅阊阉阎阏阍阈阌阒板暗闱阔阕阑阇阗阘闿阖阙闯关阚阓阐辟阛闼陉陕升阵阴陈陆阳陧队阶陨际随险陦隐陇隶只隽虽双雏杂鸡离难云电沾霡雾霁雳霭叇灵叆靓静靔腼靥巩绱秋鞒缰鞑千鞯韦韧韨韩韪韬鞲韫韵响页顶顷项顺顸须顼颂颀颃预顽颁顿颇领颌颉颐颏头颒颊颋颕颔颈颓频颓颗题额颚颜颙颛颜愿颡颠类颟颢顾颤颥显颦颅颞颧风飐飑飒台刮飓飔飏飖飕飗飘飙飚飞饣饥饤饦饨饪饫饬饭飧饮饴饲饱饰饳饺饸饼糍饷养饵饹饻饽馁饿馂饾余肴馄馃饯馅馆糊糇饧喂馉馇馎饩馏馊馌馍馒馐馑馓馈馔饥饶飨餍馋馕马驭冯驮驰驯驲驳驻驽驹驵驾骀驸驶驼驷骂骈骇骃骆骎骏骋骍骓骔骒骑骐骛骗骙䯄骞骘骝腾驺骚骟骡蓦骜骖骠骢驱骅骕骁骣骄验惊驿骤驴骧骥骦骊骉肮髅脏体髌髋发松胡须鬓斗闹哄阋阄郁鬶魉魇鱼鱽鱾鲀鲁鲂鱿鲄鲅鲆鲌鲉鲏鲇鲐鲍鲋鲊鲒鲘鲞鲕䲟鲖鲔鲛鲑鲜鲓鲪鲝鲧鲠鲩鲤鲨鲬鲻鲯鲭鲞鲷鲴鲱鲵鲲鲳鲸鲮鲰鲶鲺鳀鲫鳊鳈鲗鳂䲠鲽鳇䲡鳅鲾鳄鳆鳃鳁鳒鳑鳋鲥鳏䲢鳎鳐鳍鳁鲢鳌鳓鳘鲦鲣鲹鳗鳛鳔鳉鳙鳕鳖鳟鳝鳜鳞鲟鲼鲎鲙鳣鳡鳢鲿鲚鳠鳄鲈鲡鸟凫鸠凫鸤凤鸣鸢䴓鸩鸨鸦鸰鸵鸳鸲鸮鸱鸪鸯鸭鸸鸹鸻䴕鸿鸽䴔鸺鸼鹀鹃鹆鹁鹈鹅鹄鹉鹌鹏鹐鹎雕鹊鹓鹍䴖鸫鹑鹒鹋鹙鹕鹗鹖鹛鹜䴗鸧莺鹟鹤鹠鹡鹘鹣鹚鹚鹢鹞鸡䴘鹝鹧鹥鸥鸷鹨鸶鹪鹔鹩鹫鹇鹇鹬鹰鹭鸴㶉鹯䴙鹱鹲鸬鹴鹦鹳鹂鸾卤咸鹾碱盐丽麦麸面面曲曲面么么黄黉点党黪霉黡黩黾鼋鼌鼍冬鼹齐斋赍齑齿龀龁龂龅龇龃龆龄出龈啮龊龉龋腭龌龙厐庞䶮龚龛龟䜤鿒么簷潀痺著睪蒍两乘龟豫亚佛假传价俭儿圆处剑剂剩劳效敕劝勋单严收敍哑营啮团围图圈压垒盐增坏壤壹卖变奖娘实宽对专尧岩巢卷带归厅广废辨贰弹从德征应惠恼恶愼怀战戏戾拂拔择拜据扩擧插搜揭搔摇摄击搅齐斋晄晚晓历曾荣樱枡栈检乐槪样槇权缺欢步齿岁历每气泽滤净滨泪渴济涉澁溪满泷濑烧牺猎兽甁叠瘦发县硏碎稻穗稳穰龙粹肃丝经绘继续总缘绳纵纤绣罐飜听脑脏艳艺庄萠藏薰药萤蜡襃霸觉览观译读让丰赞转轻边递迟郞鄕醉酱酿释铁鑛钱铸炼关鬭陷险隐杂灵赖显驿驱骚验髓发鸥鸡碱曲面黑默龄岂更车贾滑串句龟龟契金喇奈懒癞罗萝螺裸逻乐洛烙珞落酪骆乱卵栏烂兰鸾岚滥蓝褴拉腊蜡廊朗浪狼郞来冷劳掳橹炉卢老芦虏路露鲁鹭碌禄绿菉录鹿论垄弄笼聋牢磊赂雷垒屡楼泪漏累缕陋勒肋凛凌棱绫菱陵读拏乐诺丹宁怒率异北磻便复不泌数索参塞省叶说杀辰沈拾若掠略亮两凉梁粮良谅量励吕女庐旅滤砺闾骊丽黎力历历轹年怜恋撚涟炼琏秊练联辇莲连炼列劣咽烈裂说廉念捻殓帘猎令囹宁岭怜玲莹羚聆铃零灵领例礼醴隶恶了僚寮尿料乐燎疗蓼辽龙晕阮刘杻柳流溜琉留硫纽类六戮陆伦仑沦轮律栗栗率隆利吏履易李梨泥理痢罹里里里离匿溺吝燐璘蔺隣鳞麟林淋临立笠粒状炙识什茶刺切度拓糖宅洞暴辐行降见廓兀嗀冢晴凞猪益礼神祥福靖精羽蘒诸逸都饭饲馆鹤郞隷侮僧免勉勤卑喝叹器塀墨层屮悔慨憎惩敏既暑梅海渚汉煮爫琢碑社祉祈祐祖祝祸祯谷突节练缙繁署者臭艹艹著褐视谒谨宾赠辶逸难响频惠馆并况全侀充冀勇勺喝啕喙嗢冢坟奄奔婢嬨廒廙彩徭惘愼愈憎慠惩戴揄搜摒敖晴朗望杖歹杀流滛滋汉瀞煮瞧爵犯猪瑱甆画瘝瘟益盛直睊著磌窱节类绦练缾者荒华蝹襁覆视调诸请谒诺谕谨变赠输迟醙铏陼难靖韛响頋频鬒龟㮝䀘䀹齃厐";
  let t2s = null;
  function toSimplified(text) {
    if (!/[\u4e00-\u9fff]/.test(text)) return text;
    if (!t2s) { t2s = new Map(); for (let i = 0; i < T2S_FROM.length; i++) t2s.set(T2S_FROM[i], T2S_TO[i]); }
    let out = '';
    for (const ch of text) out += t2s.get(ch) || ch;
    return out;
  }
  const WORD_RUN = /[\p{L}\p{N}\p{M}]+/gu;
  function normalize(text) {
    if (typeof text !== 'string' || !text) return '';
    const runs = toSimplified(text.normalize('NFKC').toLowerCase()).match(WORD_RUN);
    return runs ? runs.join(' ') : '';
  }
  /* Kana -> Hepburn-style romaji so 「ぎゅって」 meets "gyutte" and 「ヨルシカ」 "Yorushika". */
  const KANA = {
    あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o', か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko', が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
    さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo', た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
    だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do', な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no', は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
    ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo', ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po', ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
    や: 'ya', ゆ: 'yu', よ: 'yo', ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro', わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n', ゔ: 'vu', ゎ: 'wa',
  };
  const SMALL_Y = { ゃ: 'ya', ゅ: 'yu', ょ: 'yo' }, SMALL_V = { ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o' };
  const HAS_KANA = /[\u3041-\u30ff]/;
  function romanize(text) {
    let out = '', double = false;
    for (let ch of String(text)) {
      const code = ch.charCodeAt(0);
      if (code >= 0x30a1 && code <= 0x30f6) ch = String.fromCharCode(code - 0x60); // katakana -> hiragana
      if (ch === 'っ') { double = true; continue; }
      if (ch === 'ー') { const v = /[aeiou]$/.exec(out); if (v) out += v[0]; continue; }
      if (SMALL_Y[ch] && /[a-z]i$/.test(out)) { out = /(sh|ch|j)i$/.test(out) ? out.slice(0, -1) + SMALL_Y[ch].slice(1) : out.slice(0, -1) + SMALL_Y[ch]; continue; }
      if (SMALL_V[ch] && /[a-z][aeiou]$/.test(out)) { out = out.slice(0, -1) + SMALL_V[ch]; continue; }
      let roman = KANA[ch] || SMALL_Y[ch] || SMALL_V[ch];
      if (roman === undefined) { out += ch; double = false; continue; }
      if (double) { out += roman.startsWith('ch') ? 't' : roman[0]; double = false; }
      out += roman;
    }
    return out;
  }
  /* Romaji spellings vary (ō/ou/o, wo/o): compare without diacritics and doubled vowels. */
  const latinKey = text => normalize(text).normalize('NFD').replace(/\p{M}+/gu, '').replace(/([aeiou])\1+/g, '$1').replace(/ou/g, 'o').replace(/ /g, '');
  function textSimilarity(left, right) {
    const base = editSimilarity(normalize(left), normalize(right));
    if (base === 1 || !(HAS_KANA.test(left || '') || HAS_KANA.test(right || ''))) return base;
    return Math.max(base, editSimilarity(latinKey(romanize(normalize(left))), latinKey(romanize(normalize(right)))));
  }
  function editSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const ac = Array.from(a), bc = Array.from(b);
    /* Bound malicious provider metadata and the quadratic edit-distance work. */
    if (ac.length > 512 || bc.length > 512) return 0;
    const row = new Uint32Array(bc.length + 1);
    for (let j = 0; j <= bc.length; j++) row[j] = j;
    for (let i = 1; i <= ac.length; i++) {
      let previous = row[0]; row[0] = i;
      for (let j = 1; j <= bc.length; j++) {
        const old = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (ac[i - 1] !== bc[j - 1] ? 1 : 0));
        previous = old;
      }
    }
    return 1 - row[bc.length] / Math.max(ac.length, bc.length);
  }
  /* Recording variants: a candidate is only eligible when it carries the same set. */
  const VERSION_PATTERNS = [
    /(^|[^a-z])(live|concert)([^a-z]|$)|现场|演唱会|ライブ/,
    /(^|[^a-z])cover([^a-z]|$)|翻唱|原唱|翻自|カバー/,
    /(^|[^a-z])(instrumental|karaoke|off ?vocal|inst)([^a-z]|$)|伴奏|纯音乐|カラオケ|インスト/,
    /(^|[^a-z])(remix|mix|dj)([^a-z]|$)|混音|dj版|リミックス/,
    /sped[ -]?up|slowed|nightcore|加速|慢速|降调|升调/,
    /radio[ -]?edit|tv[ -]?(size|ver|edit)|short[ -]?ver|game[ -]?size|剪辑|ショート/,
    /(^|[^a-z])acoustic([^a-z]|$)|不插电/,
    /(^|[^a-z])(piano|orchestra|orchestral|music box|8[ -]?bit|lo-?fi)([^a-z]|$)|钢琴|八音盒|管弦/,
    /(^|[^a-z])demo([^a-z]|$)/,
    /* Any other "<something> ver." tag (LDDC): character / anime / band versions. */
    /[^\s(\[【〔（-]+(?:[ -]|(?<![a-z]))ver(?:sion)?\.?(?=$|[\s)\]】〕）-])|版(?=$|[\s)\]】〕）-])/,
  ];
  /* "Original Mix" / "Album Version" name the default recording, not a variant. */
  const NEUTRAL_VERSION = /(original|extended|album|main)[ -]?mix|(album|single|original|main|lp|explicit|clean|full|remaster(ed)?|stereo|mono)[ -]?ver(sion)?\.?/g;
  function versionFlags(title) {
    const lower = toSimplified(String(title || '').normalize('NFKC').toLowerCase()).replace(NEUTRAL_VERSION, '');
    let result = 0;
    VERSION_PATTERNS.forEach((pattern, i) => { if (pattern.test(lower)) result |= 1 << i; });
    return result;
  }
  /* Notes that never change the recording (Lyricify's "SpecialCompare"): featured
   * artists, explicit / deluxe / bonus / remaster tags, "From <film>", OST notes. */
  const NEUTRAL_NOTE = new RegExp('^(?:' + [
    'feat\\.?\\s.*', 'ft\\.?\\s.*', 'featuring\\s.*', 'with\\s.*', 'prod\\.?\\s.*', 'explicit', 'clean', 'bonus(?: track)?',
    'deluxe(?: edition| version)?', '(?:\\d{4}\\s+)?(?:digital(?:ly)?\\s+)?remaster(?:ed)?(?:\\s+\\d{4})?(?:\\s+version)?', 'mono', 'stereo',
    '(?:album|single|original|main|lp)\\s+version', '(?:original|extended|album)\\s+mix', 'from\\s.*', 'taken from\\s.*', '.*\\bost\\b.*',
    '.*(?:主题曲|主題曲|插曲|片头曲|片頭曲|片尾曲|主題歌|主题歌|挿入歌|オープニング|エンディング|テーマ|原声带|原聲帶|电视剧|電視劇|电影|電影|动画|動畫|アニメ|ゲーム).*',
  ].join('|') + ')$', 'i');
  const BRACKETED = /\s*[（(【\[]([^（()）【】\[\]]*)[）)】\]]/g;
  const DASH_NOTE = /\s+[-–—]\s+(.+)$/;
  /* Title without neutral notes; version notes (Live, Remix, …) are kept. */
  function titleCore(title) {
    let t = String(title || '').normalize('NFKC');
    t = t.replace(BRACKETED, (match, inner) => NEUTRAL_NOTE.test(inner.trim()) ? '' : match);
    const dash = DASH_NOTE.exec(t);
    if (dash && NEUTRAL_NOTE.test(dash[1].trim())) t = t.slice(0, dash.index);
    return t.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, '').trim();
  }
  const titleBase = titleCore;
  /* Trailing bracketed notes such as QQ's translated titles 「ぎゅって (紧紧拥住)」.
   * Version markers (Live/Remix/…) are still compared on the full title. */
  const TRAILING_NOTE = /\s*[（(【\[][^（()）【】\[\]]*[）)】\]]\s*$/;
  /** aliases: provider-side alternative titles (NetEase alias / transNames, QQ subtitle). */
  function titleSimilarity(left, right, aliases) {
    const a = titleCore(left), b = titleCore(right);
    let best = textSimilarity(a, b);
    if (best === 1) return 1;
    /* A note on one side only (Lyricify "BracketsCompare"): same song, slightly less certain. */
    const at = a.replace(TRAILING_NOTE, ''), bt = b.replace(TRAILING_NOTE, '');
    if ((at !== a || bt !== b) && at && bt) best = Math.max(best, 0.95 * textSimilarity(at, bt));
    /* Dual-language titles are accepted only when explicitly delimited. */
    const av = a.split(/\s+\/\s+/), bv = b.split(/\s+\/\s+/);
    if (av.length > 1 || bv.length > 1) for (const x of av) for (const y of bv) best = Math.max(best, textSimilarity(x, y));
    for (const alias of (aliases || []).slice(0, 8)) best = Math.max(best, 0.97 * textSimilarity(a, titleCore(alias)));
    return best;
  }
  /* One credited artist and its alternative names: "A/B" combined entries,
   * "角色 (CV: 声优)" and "歌手 (别名)" (LDDC artist_str2list). */
  function artistNames(name) {
    const full = String(name || '').normalize('NFKC').trim();
    const names = new Set([full]);
    const cv = /^(.*?)\s*[(（]\s*(?:cv|vo|vocal|唱)\s*[.:：]?\s*([^)）]+)[)）]\s*$/i.exec(full) || /^(.*?)\s*[(（]([^)）]+)[)）]\s*$/.exec(full);
    if (cv) { names.add(cv[1].trim()); names.add(cv[2].trim()); }
    for (const part of full.split(/\s*(?:[/／、;；,，]|\s(?:feat\.?|ft\.?|featuring)\s)\s*/i)) if (part) names.add(part);
    return [...names].filter(n => normalize(n));
  }
  function entrySimilarity(left, right) {
    let best = 0;
    for (const x of left) for (const y of right) { best = Math.max(best, textSimilarity(x, y)); if (best === 1) return 1; }
    return best;
  }
  const VARIOUS = /^(various artists?|群星|羣星|华语群星|v\.?\s?a\.?)$/i;
  /* The Spotify main artist must appear among the candidate's artists (order does
   * not matter); the share of artists found on both sides refines the score. */
  function artistSimilarity(left, right) {
    if (!left || !left.length || !right || !right.length) return 0;
    const L = left.map(artistNames).filter(n => n.length), R = right.map(artistNames).filter(n => n.length);
    if (!L.length || !R.length) return 0;
    if (L.length > 3 && R.length === 1 && R[0].some(n => VARIOUS.test(n))) return 0.8;
    const bestL = L.map(l => Math.max(...R.map(r => entrySimilarity(l, r))));
    const principal = bestL[0];
    /* A shared guest performer cannot substitute for the main artist. */
    if (principal < 0.75) return principal;
    const bestR = R.map(r => Math.max(...L.map(l => entrySimilarity(l, r))));
    const found = bestL.filter(s => s >= 0.8).length + bestR.filter(s => s >= 0.8).length;
    return 0.8 * principal + 0.2 * found / (L.length + R.length);
  }
  /* "Eason Chan" vs 「陈奕迅」: names in different scripts cannot be compared by text. */
  const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/, LATIN = /[a-z]/i;
  function scriptsDiffer(left, right) {
    const a = String(left || ''), b = String(right || '');
    return !!a && !!b && ((CJK.test(a) && !CJK.test(b) && LATIN.test(b)) || (CJK.test(b) && !CJK.test(a) && LATIN.test(a)));
  }

  /* ----------------------------------------------------------- match ---- */
  /* QQ Music reports whole seconds: its real length lies in [interval, interval + 1 s). */
  function durationDelta(trackMs, candidate) {
    const c = candidate.duration_ms;
    if (!(trackMs > 0) || !(c > 0)) return -1;
    if (trackMs <= c) return c - trackMs;
    return Math.max(0, trackMs - c - (candidate.provider === 'qq' ? 999 : 0));
  }
  /* Lyricify's duration grades (0 / 300 / 700 / 1500 / 3500 ms). */
  function durationScore(delta) {
    if (delta < 0) return 0;
    return delta === 0 ? 1 : delta < 300 ? 0.95 : delta < 700 ? 0.9 : delta < 1500 ? 0.8 : delta < 3500 ? 0.55 : 0;
  }
  const WEIGHTS = { title: 40, artist: 30, album: 10, duration: 20 };
  function matchScore(track, candidate) {
    const c = candidate;
    c.eligible = false; c.score = 0;
    c.delta_ms = durationDelta(track.duration_ms, c);
    c.title_score = titleSimilarity(track.title, c.title, c.aliases);
    c.artist_score = artistSimilarity(track.artists, c.artists);
    const album = !!(track.album && c.album), duration = c.delta_ms >= 0;
    c.album_score = album ? Math.max(textSimilarity(track.album, c.album), textSimilarity(titleCore(track.album), titleCore(c.album))) : 0;
    c.duration_score = durationScore(c.delta_ms);
    /* Missing optional fields do not count against a candidate: weights are re-normalised. */
    const total = WEIGHTS.title + WEIGHTS.artist + (album ? WEIGHTS.album : 0) + (duration ? WEIGHTS.duration : 0);
    c.score = 100 * (WEIGHTS.title * c.title_score + WEIGHTS.artist * c.artist_score +
      (album ? WEIGHTS.album * c.album_score : 0) + (duration ? WEIGHTS.duration * c.duration_score : 0)) / total;
    const sameVersion = versionFlags(track.title) === versionFlags(c.title);
    /* A different recording (Live, Remix, …) must not look like a near-perfect result. */
    if (!sameVersion) c.score *= 0.6;
    let reason;
    if (c.delta_ms < 0) reason = '总时长未知';
    else if (c.delta_ms > DURATION_TOLERANCE) reason = '总时长相差超过 3 秒';
    else if (!sameVersion) reason = '歌曲版本不一致';
    else if (c.title_score < 0.8) reason = '歌名相似度不足';
    else if (c.artist_score < 0.75) reason = scriptsDiffer((track.artists || [])[0], (c.artists || [])[0]) ? '艺术家名称语言不同，需歌词比对或手动确认' : '主艺术家不匹配';
    else if (c.score < 80) reason = '综合匹配分数不足';
    else { c.eligible = true; reason = '通过歌名、艺术家、专辑和时长检查'; }
    c.reason = reason;
    return c;
  }
  const strcmp = (a, b) => (a || '') < (b || '') ? -1 : (a || '') > (b || '') ? 1 : 0;
  function matchSort(candidates, preferred) {
    return candidates.sort((l, r) => {
      if (l.eligible !== r.eligible) return l.eligible ? -1 : 1;
      if (Math.abs(l.score - r.score) > 0.0001) return l.score > r.score ? -1 : 1;
      const lp = l.provider === preferred, rp = r.provider === preferred;
      if (lp !== rp) return lp ? -1 : 1;
      return strcmp(l.id, r.id);
    });
  }
  /* The preferred source wins when its best eligible result is within this many points. */
  const PREFERRED_MARGIN = 10;
  /* Every eligible candidate already shares title, main artist, version and length (±3 s),
   * so the best one is taken (LDDC / Lyricify) instead of refusing near-ties. */
  function matchSelect(candidates, preferred) {
    let best = null, pref = null;
    for (const c of candidates) {
      if (!c.eligible) continue;
      if (!best || c.score > best.score) best = c;
      if (c.provider === preferred && (!pref || c.score > pref.score)) pref = c;
    }
    if (best && pref && best !== pref && best.score - pref.score <= PREFERRED_MARGIN) return pref;
    return best;
  }
  /* Widening query cascade (Lyricify / LDDC): full metadata, then without neutral
   * notes, then the title alone (only used when nothing eligible turned up). */
  function searchQueries(track) {
    const artist = ((track.artists && track.artists[0]) || '').trim();
    const title = String(track.title || '').trim(), core = titleCore(title) || title;
    const out = [];
    const add = (text, titleOnly) => { text = text.trim(); if (text && !out.some(q => normalize(q.text) === normalize(text))) out.push({ text, titleOnly }); };
    add(`${title} ${artist}`, false);
    add(`${core} ${artist}`, false);
    if (artist) add(core, true);
    return out;
  }

  /* ----------------------------------------------------------- model ---- */
  function at(node, path) {
    if (!path) return node;
    for (const part of path.split('/')) {
      if (node == null || typeof node !== 'object') return undefined;
      node = node[part];
    }
    return node;
  }
  const str = (node, path) => { const v = at(node, path); return typeof v === 'string' ? v : ''; };
  const int = (node, path) => {
    const v = at(node, path);
    if (typeof v === 'number' && isFinite(v)) return Math.trunc(v);
    if (typeof v === 'string') { const n = parseInt(v, 10); return isFinite(n) ? n : 0; }
    return 0;
  };
  function cyrb53(text) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }
  function trackKey(track) {
    if (track.uri && !track.uri.endsWith('/NoTrack')) return track.uri;
    const raw = [normalize(track.title), normalize((track.artists || []).join('|')), normalize(track.album), track.duration_ms || 0].join('\n');
    return 'metadata:' + cyrb53(raw);
  }
  function spotifyId(uri) {
    if (!uri) return null;
    let id = null;
    if (uri.startsWith('spotify:track:')) id = uri.slice(14);
    else if (uri.startsWith('https://open.spotify.com/track/')) id = uri.slice(31);
    if (!id || !/^[A-Za-z0-9]{22}(\?.*)?$/.test(id)) return null;
    return id.slice(0, 22);
  }
  function trackEqual(l, r) {
    return !!l && !!r && l.uri === r.uri && l.title === r.title && l.album === r.album && l.duration_ms === r.duration_ms &&
      (l.artists || []).join('\n') === (r.artists || []).join('\n');
  }
  function candidateFromJson(node) {
    if (!node || typeof node !== 'object' || !str(node, 'provider') || !str(node, 'id')) return null;
    const provider = str(node, 'provider');
    if (!PROVIDERS.includes(provider)) return null;
    const strings = (value, max) => Array.isArray(value) ? value.filter(a => typeof a === 'string').slice(0, max).map(a => a.slice(0, 300)) : [];
    return {
      provider, id: str(node, 'id'), mid: str(node, 'mid'), title: str(node, 'title'), album: str(node, 'album'),
      duration_ms: int(node, 'duration_ms'), verified: node.verified === true,
      artists: strings(node.artists, 50), aliases: strings(node.aliases, 8),
    };
  }
  function candidateJson(c) {
    if (!c) return null;
    const json = { id: c.id, mid: c.mid || '', provider: c.provider, title: c.title || '', album: c.album || '', duration_ms: c.duration_ms || 0, artists: (c.artists || []).slice() };
    if (c.aliases && c.aliases.length) json.aliases = c.aliases.slice(0, 8);
    if (c.verified) json.verified = true;
    return json;
  }

  /* ---------------------------------------------------------- lyrics ---- */
  const STAMP = /^(\d+):(\d+(?:\.\d*)?)/;
  function timestamp(text, from) {
    const m = STAMP.exec(text.slice(from, from + 24));
    if (!m) return null;
    const minutes = parseInt(m[1], 10), seconds = parseFloat(m[2]);
    if (minutes > 10000 || !(seconds >= 0 && seconds < 60)) return null;
    return { time: minutes * 60000 + Math.round(seconds * 1000), end: from + m[0].length };
  }
  function enhancedWords(raw) {
    const words = []; let text = ''; let cursor = 0;
    while (cursor < raw.length) {
      if (raw[cursor] !== '<') { text += raw[cursor++]; continue; }
      const stamp = timestamp(raw, cursor + 1);
      if (!stamp || raw[stamp.end] !== '>') { text += raw[cursor++]; continue; }
      const next = raw.indexOf('<', stamp.end + 1);
      const part = next >= 0 ? raw.slice(stamp.end + 1, next) : raw.slice(stamp.end + 1);
      if (words.length) words[words.length - 1].end_time_ms = stamp.time;
      if (part) { words.push({ text: part, start_time_ms: stamp.time, end_time_ms: stamp.time }); text += part; }
      cursor = next >= 0 ? next : raw.length;
    }
    return { text, words };
  }
  /* Bumped whenever parsing changes, so lyrics stored by an older parser get re-fetched. */
  const PARSER_VERSION = 4;
  function emptyLyrics(source) { return { source, provider: source, sync_type: 'line', lines: [], parser: PARSER_VERSION }; }
  /* Whole-line singer tags: NetEase contributors mark each singer's block with
   * 【name】or（name）(【ミク】, 【2サビメイン】…), QQ duets use a standalone
   * 男：/女：/合： prefix line instead. Blocks whose timestamps overlap are voices
   * sung at the same time. The tag line itself is kept (`part_marker`) to render
   * as a small section label rather than a lyric line. */
  const PART_LABEL = /^\s*(?:【([^【】]{1,20})】|[（(]([^（）()]{1,12})[)）]|([一-鿿]{1,8})[:：])\s*$/;
  /* File-order pass over freshly pushed lines: a 【…】line only counts as a part tag
   * when a real lyric follows within 2 s, and at least two tags must exist — a lone
   * bracketed line is probably actual lyrics. Confirmed lines get a part number. */
  function confirmParts(lines) {
    let labels = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.part_marker === undefined) continue;
      let ok = false;
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].text.trim()) continue;
        const d = lines[j].start_time_ms - line.start_time_ms;
        ok = lines[j].part_marker === undefined && d >= -250 && d <= 2000;
        break;
      }
      if (ok) labels++; else line.part_marker = undefined;
    }
    if (labels < 2) { for (const line of lines) line.part_marker = undefined; return false; }
    let part = 0;
    /* Blank separator lines belong to no voice: giving them a part would truncate the
     * previous line's window at the block boundary (the blanks sit between blocks but
     * carry the next block's start time). */
    for (const line of lines) { if (line.part_marker !== undefined) part++; if (line.text.trim()) line.part = part; }
    return true;
  }
  /* Sorted-order pass: a part line's window ends when its own part advances (part_end
   * = the same part's next line) — for overlapping voices that is later than the next
   * line overall, so simultaneous lines can all stay lit. Parts whose time ranges
   * overlap are sung together; all but the first (in file order) align right (alt). */
  function finishParts(lines) {
    const ranges = new Map(), last = new Map();
    for (const line of lines) {
      if (line.part === undefined) continue;
      const prev = last.get(line.part);
      if (prev) prev.part_end = line.start_time_ms;
      last.set(line.part, line);
      if (line.part_marker !== undefined || !line.text.trim()) continue;
      const r = ranges.get(line.part);
      if (r) { r.lo = Math.min(r.lo, line.start_time_ms); r.hi = Math.max(r.hi, line.end_time_ms); }
      else ranges.set(line.part, { lo: line.start_time_ms, hi: line.end_time_ms });
    }
    let hi = -Infinity; const alt = new Set();
    for (const [id, r] of [...ranges].sort((a, b) => a[0] - b[0])) {
      if (r.lo < hi - 500) { alt.add(id); hi = Math.max(hi, r.hi); } else hi = r.hi;
    }
    for (const line of lines) if (alt.has(line.part)) line.alt = true;
    /* A part's last line had no same-part successor: keep it lit until the next
     * section tag — its end_time is the next line overall, which inside an
     * overlapping region belongs to another voice and would dim it mid-phrase. */
    let mark = Infinity;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line.part === undefined) continue;
      if (line.part_marker !== undefined) mark = line.start_time_ms;
      if (line.part_end === undefined) line.part_end = mark === Infinity ? line.end_time_ms : Math.max(mark, line.end_time_ms);
    }
  }
  function parseLrc(lrc, translation, source) {
    const result = emptyLyrics(source);
    if (typeof lrc !== 'string' || lrc.length > MAX_RESPONSE) return result;
    const rawLines = lrc.split('\n');
    let lines = [], offset = 0, hasWords = false;
    for (let i = 0; i < rawLines.length && lines.length < 10000; i++) {
      let p = rawLines[i].trim();
      if (p.charCodeAt(0) === 0xfeff) p = p.slice(1);
      if (p.startsWith('[offset:')) { offset = Math.max(-3600000, Math.min(3600000, parseInt(p.slice(8), 10) || 0)); continue; }
      const times = []; let pos = 0;
      while (p[pos] === '[') {
        const stamp = timestamp(p, pos + 1);
        if (!stamp || p[stamp.end] !== ']') break;
        times.push(stamp.time); pos = stamp.end + 1;
      }
      const body = p.slice(pos);
      for (const time of times) {
        const parsed = enhancedWords(body);
        hasWords = hasWords || parsed.words.length > 0;
        const label = PART_LABEL.exec(parsed.text);
        lines.push({ text: parsed.text, start_time_ms: time, end_time_ms: time, words: parsed.words, part_marker: label ? label[1] || label[2] || label[3] : undefined });
      }
    }
    if (!lines.length) {
      result.sync_type = 'unsynced';
      for (const raw of rawLines) {
        const text = raw.trim();
        if (text && text[0] !== '[' && lines.length < 10000) lines.push({ text, start_time_ms: 0, end_time_ms: 0, words: [] });
      }
    } else if (hasWords) result.sync_type = 'word';
    const parts = confirmParts(lines);
    lines.sort((a, b) => a.start_time_ms - b.start_time_ms);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const start = line.start_time_ms - offset;
      const end = i + 1 < lines.length ? lines[i + 1].start_time_ms - offset : start + 10000;
      line.start_time_ms = start; line.end_time_ms = Math.max(start, end);
      for (const word of line.words) {
        const ws = word.start_time_ms - offset, we = word.end_time_ms - offset;
        word.start_time_ms = ws; word.end_time_ms = we > ws ? we : Math.max(ws, line.end_time_ms);
      }
    }
    if (parts) finishParts(lines);
    result.lines = lines;
    if (translation) mergeTranslation(lines, translation, source);
    return result;
  }
  function mergeTranslation(lines, translation, source) {
    /* ytlrc may itself be word-timed ([start,dur](wordStart,wordDur,0)…) rather than LRC. */
    const parsed = /^\s*\[\d+,\d+\]/m.test(translation || '') ? parseYrc(translation, null, source) : parseLrc(translation, null, source);
    const translated = parsed.lines.filter(l => l.text.trim() && l.text.trim() !== '//');
    /* Blank/interlude lines must not swallow a translation meant for a real line. */
    const targets = [];
    lines.forEach((line, i) => { if (line.text.trim()) targets.push(i); });
    if (!translated.length || !targets.length) return;
    /* NetEase normally stamps a translation with exactly the same time as its original line:
     * take those pairs first, strictly. */
    const rest = [];
    const byTime = new Map();
    for (const i of targets) { const k = lines[i].start_time_ms; if (!byTime.has(k)) byTime.set(k, i); }
    for (const t of translated) {
      const i = byTime.get(t.start_time_ms);
      if (i !== undefined && !lines[i].translated_text) lines[i].translated_text = t.text; else rest.push(t);
    }
    /* Word-timed (yrc) timestamps can drift from the translation's: align what is left
     * monotonically to the nearest original line that still has no translation. */
    const TOLERANCE = 3000;
    const free = targets.filter(i => !lines[i].translated_text);
    let from = 0;
    for (const t of rest) {
      let best = -1, bestDiff = Infinity;
      for (let k = from; k < free.length; k++) {
        const diff = Math.abs(lines[free[k]].start_time_ms - t.start_time_ms);
        if (diff < bestDiff) { best = k; bestDiff = diff; }
        else if (lines[free[k]].start_time_ms > t.start_time_ms) break;
      }
      if (best < 0 || bestDiff > TOLERANCE) continue;
      lines[free[best]].translated_text = t.text; from = best + 1;
    }
  }
  /* Lyric lines compared without word spacing, ruby glosses (輝(またた)いて) or
   * punctuation — yrc words and lrc text tokenize the same line differently. */
  function lyricKey(text) {
    return (text || '').replace(/[（(][^（）()]*[)）]/g, '')
      .replace(/[\s　]+/g, '')
      .replace(/[!！?？。、，,．.・…~～ー\-—'’'"“”‘’♪♡♥]/g, '');
  }
  /* ytlrc is sometimes an auto-aligned subset of tlyric (short interjections dropped),
   * so preferring it discards real translations. Recover them by bridging through the
   * line-timed lrc, which shares tlyric's timeline: each still-untranslated line is
   * matched to the lrc line with the same text — immune to yrc/tlyric timestamp drift. */
  function mergeTranslationByText(lines, lrc, tlyric, source) {
    if (!tlyric || !tlyric.trim() || !lrc || !lrc.trim()) return;
    const ref = parseLrc(lrc, tlyric, source).lines.filter(l => lyricKey(l.text));
    if (!ref.length) return;
    let cursor = 0;
    for (const line of lines) {
      if (line.translated_text) continue;
      const k = lyricKey(line.text);
      if (!k) continue;
      /* Lines align ~1:1 in order; a window keeps repeated/failed lines from derailing. */
      for (let j = cursor; j < ref.length && j < cursor + 15; j++) {
        if (lyricKey(ref[j].text) !== k) continue;
        if (ref[j].translated_text) line.translated_text = ref[j].translated_text;
        cursor = j + 1;
        break;
      }
    }
  }
  function spotifyLyrics(response) {
    const result = emptyLyrics('spotify');
    const root = at(response, 'lyrics');
    const source = at(root, 'lines');
    if (!Array.isArray(source)) return result;
    const sync = str(root, 'syncType');
    result.sync_type = sync === 'SYLLABLE_SYNCED' ? 'word' : sync === 'LINE_SYNCED' ? 'line' : 'unsynced';
    result.language = str(root, 'language');
    result.provider = str(root, 'provider');
    result.provider_name = str(root, 'providerDisplayName');
    for (let i = 0; i < source.length; i++) {
      const input = source[i];
      let text = str(input, 'text') || str(input, 'words');
      const start = int(input, 'startTimeMs');
      let end = int(input, 'endTimeMs');
      if (end <= start) end = i + 1 < source.length ? int(source[i + 1], 'startTimeMs') : start + 10000;
      const line = { text, start_time_ms: start, end_time_ms: end, words: [] };
      const syllables = Array.isArray(input.syllables) ? input.syllables : Array.isArray(input.words) ? input.words : null;
      if (syllables && syllables.length) {
        let joined = '';
        syllables.forEach((part, j) => {
          const partText = str(part, 'string') || str(part, 'text');
          const ws = int(part, 'startTimeMs');
          let we = int(part, 'endTimeMs');
          if (we <= ws) we = j + 1 < syllables.length ? int(syllables[j + 1], 'startTimeMs') : end;
          line.words.push({ text: partText, start_time_ms: ws, end_time_ms: we }); joined += partText;
        });
        if (!text) line.text = joined;
      }
      result.lines.push(line);
    }
    if (result.sync_type !== 'word') for (const line of result.lines) line.words = [];
    return result;
  }
  function lyricsUsable(lyrics) {
    return !!(lyrics && Array.isArray(lyrics.lines) && lyrics.lines.some(line => line && line.text));
  }
  function lyricsIndex(lyrics, position) {
    const lines = lyrics && lyrics.lines;
    if (!Array.isArray(lines)) return -1;
    let low = 0, high = lines.length - 1, found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (lines[middle].start_time_ms <= position) { found = middle; low = middle + 1; } else high = middle - 1;
    }
    return found;
  }
  /* Share of the reference's distinct lines (first 40) found in the candidate;
   * kana lines are also compared in romaji. Used to confirm a match by content. */
  function lyricsSimilarity(reference, candidate) {
    const keys = lyrics => {
      const seen = new Map();
      for (const line of (lyrics && lyrics.lines) || []) {
        if (!line.text || CREDIT_LINE.test(line.text)) continue;
        const n = normalize(line.text);
        if (n && !seen.has(n)) seen.set(n, HAS_KANA.test(n) ? latinKey(romanize(n)) : latinKey(n));
      }
      return [...seen];
    };
    const ref = keys(reference).slice(0, 40), cand = keys(candidate);
    if (ref.length < 4 || cand.length < 4) return 0;
    const exact = new Set(cand.flatMap(([n, k]) => [n, k]));
    let hit = 0;
    for (const [n, k] of ref) {
      if (exact.has(n) || exact.has(k) || cand.some(([cn, ck]) => editSimilarity(cn, n) >= 0.8 || editSimilarity(ck, k) >= 0.8)) hit++;
    }
    return hit / ref.length;
  }
  function stamp(time, left, right) {
    time = Math.max(0, Math.round(time));
    const pad = (n, w) => String(n).padStart(w, '0');
    return left + pad(Math.floor(time / 60000), 2) + ':' + pad(Math.floor(time / 1000) % 60, 2) + '.' + pad(time % 1000, 3) + right;
  }
  /* Canonical fingerprint of a lyrics body: text, translation and all timings — any
   * upstream correction (typo fix, added translation, retimed words) changes it. */
  function lyricsDigest(lyrics) {
    const lines = (lyrics && lyrics.lines) || [];
    return cyrb53(JSON.stringify([
      (lyrics && lyrics.sync_type) || '',
      lines.map(l => [l.text || '', l.translated_text || '', l.start_time_ms | 0, l.end_time_ms | 0,
        (l.words || []).map(w => [w.text || '', w.start_time_ms | 0, w.end_time_ms | 0])]),
    ]));
  }
  function exportLrc(lyrics) {
    let text = '';
    for (const line of (lyrics && lyrics.lines) || []) {
      if (lyrics.sync_type !== 'unsynced') text += stamp(line.start_time_ms, '[', ']');
      if (line.words && line.words.length) {
        line.words.forEach((word, j) => {
          text += stamp(word.start_time_ms, '<', '>') + word.text;
          if (j + 1 === line.words.length) text += stamp(word.end_time_ms, '<', '>');
        });
      } else text += line.text;
      text += '\n';
    }
    return text;
  }

  /* ------------------------------------------------------- providers ---- */
  function addSong(array, provider, song) {
    if (!song || typeof song !== 'object' || Array.isArray(song) || array.length >= 100) return;
    const qq = provider === 'qq';
    const title = str(song, qq ? 'title' : 'name');
    const id = int(song, 'id');
    if (!id || !title) return;
    let album = str(song, qq ? 'album/title' : 'album/name');
    if (!album) album = str(song, qq ? 'album/name' : 'al/name');
    let duration = qq ? Math.max(0, Math.min(86400, int(song, 'interval'))) * 1000 : (int(song, 'duration') || int(song, 'dt'));
    if (duration < 0 || duration > 86400000) duration = 0;
    let artists = at(song, qq ? 'singer' : 'artists');
    if (!artists) artists = at(song, 'ar');
    artists = Array.isArray(artists) ? artists.slice(0, 50).map(a => str(a, 'name')) : [];
    /* Alternative titles: NetEase alias / transNames, QQ name / subtitle (e.g. a translated title). */
    const aliases = [];
    const alias = text => { if (typeof text === 'string' && text.trim() && text !== title && !aliases.includes(text) && aliases.length < 8) aliases.push(text.slice(0, 300)); };
    for (const path of qq ? ['name', 'subtitle'] : ['alias', 'transNames', 'alia', 'tns']) {
      const value = at(song, path);
      if (Array.isArray(value)) value.forEach(alias); else alias(value);
    }
    const candidate = { provider, id: String(id), mid: str(song, 'mid'), title, album, duration_ms: duration, artists, aliases };
    if (array.some(o => o.id === candidate.id && o.provider === provider)) return;
    array.push(candidate);
  }
  function providerCandidates(provider, response) {
    const result = [];
    /* Signed QQ search answers under the module name; old format used req_1. */
    const paths = provider === 'qq'
      ? ['music.search.SearchCgiService/data/body/song/list', 'req_1/data/body/song/list', 'req/data/body/song/list', 'result/songs', 'songs', 'data']
      : ['result/songs', 'songs', 'req_1/data/body/song/list', 'data'];
    for (const path of paths) {
      const node = at(response, path);
      if (!Array.isArray(node)) continue;
      for (const song of node) {
        if (result.length >= 100) break;
        addSong(result, provider, song);
        const group = at(song, 'group');
        if (Array.isArray(group)) for (const item of group) { if (result.length >= 100) break; addSong(result, provider, item); }
      }
      break;
    }
    return result;
  }
  const NETEASE = 'https://music.163.com';
  const QQ = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
  /* Compact SHA-1 (RFC 3174) for the QQ request signature below. */
  function sha1(text) {
    const bytes = new TextEncoder().encode(text), len = bytes.length;
    const msg = new Uint8Array(((len + 8) >> 6 << 6) + 64);
    msg.set(bytes); msg[len] = 0x80;
    const view = new DataView(msg.buffer);
    view.setUint32(msg.length - 4, len * 8);   // big-endian bit length (inputs < 512 MiB)
    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    const W = new Int32Array(80), rol = (x, n) => (x << n) | (x >>> (32 - n));
    for (let off = 0; off < msg.length; off += 64) {
      for (let i = 0; i < 16; i++) W[i] = view.getInt32(off + i * 4);
      for (let i = 16; i < 80; i++) W[i] = rol(W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16], 1);
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        let f, k;
        if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
        else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
        else { f = b ^ c ^ d; k = 0xca62c1d6; }
        const t = (rol(a, 5) + f + e + k + W[i]) | 0;
        e = d; d = c; c = rol(b, 30); b = a; a = t;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }
    return [h0, h1, h2, h3, h4].map(v => (v >>> 0).toString(16).padStart(8, '0')).join('').toUpperCase();
  }
  /* QQ Music anonymous-search risk control: unsigned searches return empty
   * results (is_filter=-2). The web/desktop client posts the same JSON body to
   * musics.fcg?sign=zzc… — the "zzc" signature scrambles the SHA-1 of the body
   * (algorithm published by jixunmoe/qmweb-sign, MIT). UA / Referer / cookies
   * do not matter; only the signature does. */
  const ZZC_PART1 = [23, 14, 6, 36, 16, 40, 7, 19], ZZC_PART2 = [16, 1, 32, 12, 19, 27, 8, 5];
  const ZZC_SCRAMBLE = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179];
  function zzcSign(text) {
    const hash = sha1(text), pick = ix => ix.map(i => hash[i]).join('');
    const part3 = ZZC_SCRAMBLE.map((v, i) => v ^ parseInt(hash.slice(i * 2, i * 2 + 2), 16));
    const b64 = btoa(String.fromCharCode(...part3)).replace(/[\\/+=]/g, '');
    return `zzc${pick(ZZC_PART1)}${b64}${pick(ZZC_PART2)}`.toLowerCase();
  }
  const qqSearchId = () => {
    let s = '';
    for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s.toUpperCase() + String(Math.floor(Math.random() * 100000)).padStart(5, '0');
  };
  const qqGuid = () => qqSearchId().slice(0, 32);
  /* Builds the HTTP request for a provider search, including direct song links. */
  function searchRequest(provider, query) {
    const normalized = normalize(query);
    if (provider === 'qq') {
      if (query.includes('y.qq.com/')) {
        const m = /(?:songDetail|song)\/([A-Za-z0-9]{1,64})/.exec(query);
        if (m) {
          return {
            method: 'POST', url: 'https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg',
            headers: { Referer: 'https://c.y.qq.com/', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `songmid=${m[1]}&format=jsonp&callback=getOneSongInfoCallback&g_tk=5381&platform=yqq&outCharset=utf8`,
          };
        }
      }
      const body = JSON.stringify({
        comm: {
          _channelid: '0', _os_version: '6.2.9200-2', ct: '19', cv: '2151', guid: qqGuid(), patch: '118',
          psrf_access_token_expiresAt: 0, psrf_qqaccess_token: '', psrf_qqopenid: '', psrf_qqunionid: '',
          tmeAppID: 'qqmusic', tmeLoginType: 0, uin: '0', wid: String(Math.floor(Math.random() * 8e18) + 1e18),
        },
        'music.search.SearchCgiService': {
          module: 'music.search.SearchCgiService', method: 'DoSearchForQQMusicDesktop',
          param: { grp: 1, num_per_page: 20, page_num: 1, query: normalized, remoteplace: 'txt.newclient.top', search_type: 0, searchid: qqSearchId() },
        },
      });
      return {
        method: 'POST', url: `https://u.y.qq.com/cgi-bin/musics.fcg?sign=${zzcSign(body)}`,
        headers: { Referer: 'https://c.y.qq.com/', 'Content-Type': 'application/json' }, body,
      };
    }
    let url = `${NETEASE}/api/search/get/web?s=${encodeURIComponent(normalized)}&type=1&offset=0&total=false&limit=20`;
    if (query.includes('music.163.com/')) {
      const m = /(?:[?&]id=|song\/)(\d+)/.exec(query);
      if (m) url = `${NETEASE}/api/song/detail/?id=${m[1]}&ids=%5B${m[1]}%5D`;
    }
    return { method: 'GET', url, headers: { Referer: 'https://music.163.com/' }, body: null };
  }
  /* Ordered list of lyric requests; later entries are fallbacks tried on errors. */
  function fetchRequests(candidate) {
    if (candidate.provider === 'qq') {
      const requests = [fetchRequest(candidate)];
      /* Legacy web endpoint as a fallback (base64 lyric/trans, -1901 = none). */
      if (candidate.mid) requests.push({
        method: 'POST', url: 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg',
        headers: { Referer: 'https://y.qq.com/', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `songmid=${encodeURIComponent(candidate.mid)}&g_tk=5381&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`,
      });
      return requests;
    }
    const id = encodeURIComponent(candidate.id), headers = { Referer: 'https://music.163.com/' };
    return [
      /* Current endpoint: also returns word-timed yrc + its translation ytlrc. */
      { method: 'GET', url: `${NETEASE}/api/song/lyric/v1?id=${id}&cp=false&lv=0&kv=0&tv=0&rv=0&yv=0&ytv=0&yrv=0`, headers, body: null },
      { method: 'GET', url: `${NETEASE}/api/song/lyric?id=${id}&lv=-1&kv=-1&tv=-1`, headers, body: null },
    ];
  }
  function fetchRequest(candidate) {
    if (candidate.provider === 'qq') {
      return {
        method: 'POST', url: QQ, headers: { Referer: 'https://c.y.qq.com/', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comm: { ct: 24, cv: 4747474, format: 'json', g_tk: '5381', g_tk_new_20200303: '5381', inCharset: 'utf-8', outCharset: 'utf-8', platform: 'yqq.json', uin: 0 },
          req_1: { module: 'music.musichallSong.PlayLyricInfo', method: 'GetPlayLyricInfo', param: { qrc: 0, qrc_t: 0, roma: 0, trans: 1, songID: parseInt(candidate.id, 10) || 0, songMID: candidate.mid || '' } },
        }),
      };
    }
    return { method: 'GET', url: `${NETEASE}/api/song/lyric?id=${encodeURIComponent(candidate.id)}&lv=-1&kv=-1&tv=-1`, headers: { Referer: 'https://music.163.com/' }, body: null };
  }
  function decodeLyric(text) {
    if (!text) return '';
    if (text.includes('[')) return text;
    try {
      const binary = atob(text);
      const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (_) { return ''; }
  }
  class ProviderError extends Error {
    constructor(message, kind) { super(message); this.kind = kind || 'failed'; }
  }
  /* Parses a provider response body; throws ProviderError on service errors. */
  function parseProviderBody(provider, body) {
    let raw;
    try { raw = JSON.parse(body); } catch (_) {
      const start = body ? body.indexOf('(') : -1, end = body ? body.lastIndexOf(')') : -1;
      if (start >= 0 && end > start) { try { raw = JSON.parse(body.slice(start + 1, end)); } catch (_) { /* fallthrough */ } }
    }
    if (raw === undefined) throw new ProviderError(`${PROVIDER_NAMES[provider]} 返回了无法解析的数据`);
    const code = int(raw, 'code'), inner = int(raw, 'req_1/code') || int(raw, 'req/code') || int(raw, 'music.search.SearchCgiService/code');
    /* GetPlayLyricInfo answers 24001 when QQ has no lyric for the song. */
    if (provider === 'qq' && code === 0 && inner === 24001) return raw;
    if (provider === 'qq' && code === -1901) return raw;
    /* QQ answers 2001 intermittently (anti-spam); callers retry it once. */
    if ((code !== 0 && code !== 200) || inner !== 0) {
      const value = inner || code;
      if (value === 2001) throw new ProviderError(`${PROVIDER_NAMES[provider]} 暂时限流（2001），请稍后重试`, 'transient');
      throw new ProviderError(`${PROVIDER_NAMES[provider]} 服务返回错误码 ${value}`, 'failed');
    }
    return raw;
  }
  /* NetEase v1 lyrics carry credits as JSON lines ({"t":0,"c":[...]}); drop them. */
  const dropJsonLines = text => (text || '').split('\n').filter(line => !line.trim().startsWith('{')).join('\n');
  const CREDIT_LINE = /^\s*(?:作词|作詞|作曲|编曲|編曲|词|詞|曲|制作人|製作人|监制|監製|制作|製作|混音|母带|母帶|和声|和聲|录音|錄音|吉他|贝斯|鼓|弦乐|配唱|原唱|翻唱|演唱|歌手|出品|发行|發行|OP|SP|Lyrics?(?: by)?|Lyricist|Written by|Composer|Composed by|Music(?: by)?|Arrange(?:r|d by)|Producer|Produced by|Vocal(?:s| by)?)\s*[:：]/i;
  const INSTRUMENTAL = /纯音乐[，,]?\s*请欣赏|純音樂[，,]?\s*請欣賞|此歌曲为没有填词的纯音乐|instrumental/i;
  /* Word-timed NetEase lyrics: [lineStart,lineDur](wordStart,wordDur,0)text… */
  function parseYrc(yrc, translation, source) {
    const result = emptyLyrics(source);
    if (typeof yrc !== 'string' || yrc.length > MAX_RESPONSE) return result;
    const TOKEN = /\((\d+),(\d+),-?\d+\)/g;
    for (const raw of yrc.split('\n')) {
      const m = /^\[(\d+),(\d+)\](.*)$/.exec(raw.trim());
      if (!m || result.lines.length >= 10000) continue;
      const start = +m[1], body = m[3], tokens = [];
      let t; TOKEN.lastIndex = 0;
      while ((t = TOKEN.exec(body))) tokens.push({ index: t.index, end: TOKEN.lastIndex, start: +t[1], dur: +t[2] });
      const words = tokens.map((tk, i) => ({ text: body.slice(tk.end, i + 1 < tokens.length ? tokens[i + 1].index : body.length), start_time_ms: tk.start, end_time_ms: tk.start + tk.dur }))
        .filter(w => w.text);
      const text = words.length ? words.map(w => w.text).join('') : body.replace(TOKEN, '');
      const label = PART_LABEL.exec(text);
      result.lines.push({ text, start_time_ms: start, end_time_ms: start + Math.max(0, +m[2]), words, part_marker: label ? label[1] || label[2] || label[3] : undefined });
    }
    const parts = confirmParts(result.lines);
    result.lines.sort((a, b) => a.start_time_ms - b.start_time_ms);
    if (parts) finishParts(result.lines);
    result.sync_type = result.lines.some(l => l.words.length) ? 'word' : 'line';
    if (translation) mergeTranslation(result.lines, translation, source);
    return result;
  }
  /* Placeholder lyrics (credits only, "纯音乐，请欣赏") are not lyrics. */
  function finalizeLyrics(lyrics, note) {
    const texts = lyrics.lines.map(l => l.text.trim()).filter(Boolean);
    if (!note && texts.length && texts.every(t => CREDIT_LINE.test(t))) note = 'credits';
    if (!note && texts.length && texts.length <= 3 && texts.some(t => INSTRUMENTAL.test(t))) note = 'instrumental';
    if (note) { lyrics.lines = []; lyrics.note = note; }
    return lyrics;
  }
  function lyricsFromResponse(provider, raw) {
    if (provider === 'qq') {
      if (int(raw, 'req_1/code') === 24001 || int(raw, 'code') === -1901) return finalizeLyrics(emptyLyrics('qq'), 'missing');
      if (!at(raw, 'req_1') && typeof at(raw, 'lyric') === 'string') return finalizeLyrics(parseLrc(decodeLyric(str(raw, 'lyric')), decodeLyric(str(raw, 'trans')), 'qq'));
      return finalizeLyrics(parseLrc(decodeLyric(str(raw, 'req_1/data/lyric')), decodeLyric(str(raw, 'req_1/data/trans')), 'qq'));
    }
    if (at(raw, 'uncollected') === true) return finalizeLyrics(emptyLyrics('netease'), 'uncollected');
    if (at(raw, 'nolyric') === true) return finalizeLyrics(emptyLyrics('netease'), 'instrumental');
    const lrc = dropJsonLines(str(raw, 'lrc/lyric')), tlyric = dropJsonLines(str(raw, 'tlyric/lyric'));
    const yrc = dropJsonLines(str(raw, 'yrc/lyric')), ytlrc = dropJsonLines(str(raw, 'ytlrc/lyric'));
    let lyrics = yrc.trim() ? parseYrc(yrc, ytlrc || tlyric, 'netease') : null;
    if (!lyricsUsable(lyrics)) lyrics = parseLrc(lrc, tlyric, 'netease');
    else mergeTranslationByText(lyrics.lines, lrc, tlyric, 'netease');
    /* v1 sends credits as JSON lines; if nothing else remains it is a credits-only placeholder. */
    const creditsOnly = !lyricsUsable(lyrics) && /^\s*\{/m.test(str(raw, 'lrc/lyric') + str(raw, 'yrc/lyric'));
    return finalizeLyrics(lyrics, creditsOnly ? 'credits' : undefined);
  }

  /* -------------------------------------------------------- requests ---- */
  /* Mirrors sl_http_request: budget, cooldown after 429, transient retries. */
  class Http {
    constructor(transport) {
      this.transport = transport; this.cooldown = new Map(); this.inflight = new Map();
      this.stats = { requests: 0, sent_bytes: 0, received_bytes: 0, cache_hits: 0 };
    }
    cacheHit() { this.stats.cache_hits++; }
    async request(provider, req, { signal, budget, retries = 0 } = {}) {
      retries = Math.min(retries, 2);
      /* Identical concurrent requests share one network round-trip. */
      const key = `${req.method} ${req.url} ${req.body || ''}`;
      if (this.inflight.has(key)) return this.inflight.get(key);
      const promise = this._request(provider, req, signal, budget, retries).finally(() => this.inflight.delete(key));
      this.inflight.set(key, promise);
      return promise;
    }
    async _request(provider, req, signal, budget, retries) {
      for (let attempt = 1; ; attempt++) {
        if (signal && signal.aborted) throw new ProviderError('请求已取消', 'cancelled');
        const until = this.cooldown.get(provider);
        if (until && until > Date.now()) throw new ProviderError('来源正在限流冷却，请稍后重试', 'blocked');
        if (budget && budget.remaining <= 0) throw new ProviderError('本次请求预算已用完', 'blocked');
        if (budget) budget.remaining--;
        this.stats.requests++;
        this.stats.sent_bytes += req.url.length + (req.body ? req.body.length : 0) + 200;
        let response, error = null;
        try { response = await this.transport(req, signal); } catch (e) { error = e; }
        if (signal && signal.aborted) throw new ProviderError('请求已取消', 'cancelled');
        const status = response ? response.status : 0;
        if (response) this.stats.received_bytes += (response.body || '').length + 200;
        if (status === 429) {
          const header = response.retryAfter;
          let delay = 60;
          if (header && /^\d/.test(header)) delay = parseInt(header, 10);
          else if (header) { const date = Date.parse(header); if (!isNaN(date)) delay = (date - Date.now()) / 1000; }
          this.cooldown.set(provider, Date.now() + Math.max(delay, 1) * 1000);
          throw new ProviderError(`${PROVIDER_NAMES[provider] || provider}：请求过多，已进入冷却`, 'http');
        }
        const transient = status === 502 || status === 503 || status === 504 || (error && error.transient);
        if (transient && attempt <= retries && !(budget && budget.remaining <= 0)) {
          await new Promise(r => setTimeout(r, 500 << Math.min(attempt, 3)));
          continue;
        }
        if (error) throw error instanceof ProviderError ? error : new ProviderError(String(error.message || error), error.kind || 'network');
        if (response.body && response.body.length > MAX_RESPONSE) throw new ProviderError('响应超过 2 MiB 限制');
        return response;
      }
    }
  }

  /* --------------------------------------------------------- engine ----- */
  const CANCELLED = Symbol('cancelled');
  /* Shared bindings fetched from the lyrics server are cached locally for a while. */
  const CLOUD_CACHE = 'cloud1:', CLOUD_TTL = 1800, CLOUD_MISS_TTL = 600;
  /* Per-track offset ("偏移"): stored here, uploaded with the lyrics by the upload button. */
  const OFFSET_KEY = 'offset:', MAX_OFFSET = 5000;
  const clampOffset = v => Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, Math.round(Number(v) || 0)));
  /* Background matching (upcoming tracks) fills the caches without touching the screen. */
  const SILENT = { install() {}, status() {} };
  const trackPayload = t => ({ uri: t.uri || '', title: t.title || '', artists: (t.artists || []).slice(0, 20), album: t.album || '', duration_ms: t.duration_ms || 0 });

  /* Runs entirely on the client: NetEase / QQ requests go through deps.http (direct, or
   * relayed by the lyrics server / local service when the renderer may not reach them);
   * the lyrics server (deps.cloud) only stores matches and lyrics that users chose or
   * uploaded. Without deps.cloud (pure local mode) everything stays on this machine. */
  class Engine {
    /**
     * deps: { store, http: Http, cloud?: Cloud, settings(): {preferred_provider, spotify_first, verify_lyrics},
     *         spotify?(track, signal) -> Promise<{lyrics, colors}|null|undefined>, onChange?() }
     */
    constructor(deps) {
      this.deps = deps; this.store = deps.store; this.http = deps.http; this.cloud = deps.cloud || null;
      this.track = null; this.lyrics = null; this.colors = null; this.status = '等待播放器';
      /* Where the current lyrics come from: the provider song (null for Spotify / local files)
       * and how it was chosen: local | cloud | manual | auto | verified | spotify. */
      this.match = null; this.origin = null; this.cloudError = '';
      this.generation = 0; this.controller = null; this.busy = false;
      this.ui = { install: (...args) => this._install(...args), status: text => this._setStatus(text) };
      /* Upcoming tracks: key -> running background match / time it finished. */
      this.prefetching = new Map(); this.prefetched = new Map(); this.upcoming = []; this.prefetchActive = false;
      /* The lyrics server's copy for the playing track: undefined unknown, null none, or the binding. */
      this.remote = undefined;
      /* The bound provider song's newer copy when the server's stored lyrics fell behind
       * (offered at the upload button), and the running background check for it. */
      this.remoteUpdate = null; this.updateCheck = null;
    }
    _changed() { try { this.deps.onChange && this.deps.onChange(); } catch (e) { console.error('[spot-lyric]', e); } }
    _setStatus(text) { this.status = text; this._changed(); }
    _install(lyrics, colors, match, origin) {
      /* A manual choice or a new track supersedes a pending platform update. */
      if (this.remoteUpdate && lyrics !== this.remoteUpdate.lyrics) this.remoteUpdate = null;
      this.lyrics = lyrics ? JSON.parse(JSON.stringify(lyrics)) : null;
      this.colors = colors || null;
      this.match = lyrics && match ? candidateFromJson(candidateJson(match)) : null;
      this.origin = lyrics ? origin || null : null;
      if (this.lyrics && this.track) { this.lyrics.track_uri = this.track.uri; this.lyrics.track_id = spotifyId(this.track.uri) || ''; }
    }
    _preferred() {
      const p = this.deps.settings().preferred_provider;
      return PROVIDERS.includes(p) ? p : 'netease';
    }
    offset() {
      if (!this.track) return 0;
      return (this.store.getInt('timing-offset-ms', 0)) + this.trackOffset(this.track);
    }
    /* The offset of one track (without the global one). Set on this machine it wins; otherwise
     * lyrics loaded from the server bring the offset that was uploaded with them. */
    trackOffset(track) {
      if (!track) return 0;
      const own = this.store.get(OFFSET_KEY + trackKey(track), null);
      if (own != null && own !== '') return clampOffset(parseInt(own, 10));
      const remote = this.remote;
      return this.origin === 'cloud' && remote && typeof remote.offset_ms === 'number' && trackEqual(track, this.track) ? clampOffset(remote.offset_ms) : 0;
    }
    /* Only stored here: the upload button saves it on the lyrics server with the lyrics. */
    setOffset(value, global) {
      if (!global && !this.track) return;
      const key = global ? 'timing-offset-ms' : OFFSET_KEY + trackKey(this.track);
      this.store.set(key, String(clampOffset(value)));
      this._changed();
    }
    /** How the lyrics on screen compare with the copy on the lyrics server:
     * undefined unknown (not checked / unreachable), 'none' nothing stored, 'same', or what differs: 'lyrics' | 'offset'. */
    remoteState() {
      const doc = this.remote, lyrics = this.lyrics;
      if (doc === undefined || !this.track) return undefined;
      if (!doc) return 'none';
      if (!lyricsUsable(lyrics)) return 'lyrics';
      const match = this.match, lines = (doc.lyrics && doc.lyrics.lines) || [];
      const sameSource = doc.match && match ? doc.match.provider === match.provider && String(doc.match.id) === String(match.id)
        : !doc.match && !match && (doc.source || (doc.lyrics && doc.lyrics.source)) === lyrics.source;
      const sameLines = lines.length === lyrics.lines.length && lines.every((l, i) => l.text === lyrics.lines[i].text && l.start_time_ms === lyrics.lines[i].start_time_ms);
      if (!sameSource || !sameLines) return 'lyrics';
      return (typeof doc.offset_ms === 'number' ? clampOffset(doc.offset_ms) : 0) === this.trackOffset(this.track) ? 'same' : 'offset';
    }
    _interrupt() { if (this.controller) this.controller.abort(); this.generation++; this.busy = false; }
    async importLyrics(lyrics) {
      if (!lyricsUsable(lyrics) || !this.track) return;
      this._interrupt();
      await this.store.kvSet('local-lyrics:' + trackKey(this.track), JSON.stringify(lyrics));
      this.prefetched.delete(trackKey(this.track));
      this._install(lyrics, null, null, 'local'); this._setStatus('已绑定本地歌词');
    }

    /* Provider search with cache, negative cooldown and budget (providers.c). */
    async providerSearch(provider, query, signal, budget) {
      const key = `search2:${provider}:${normalize(query)}`;
      const cached = await this._cached(key, provider);
      if (cached !== undefined) return cached.map(c => candidateFromJson(c)).filter(Boolean);
      try {
        const raw = await this._exchange(provider, searchRequest(provider, query), signal, budget, 2);
        const candidates = providerCandidates(provider, raw);
        await this.store.cachePut(key, JSON.stringify(candidates.map(candidateJson)), 86400);
        return candidates;
      } catch (e) { await this._failure(provider, e); throw e; }
    }
    /* fresh skips the (permanent) lyrics cache and asks the provider for its current
     * copy — the update check uses it; the failure cooldown still applies. */
    async providerFetch(candidate, signal, budget, fresh) {
      const key = `${LYRICS_CACHE}:${candidate.provider}:${candidate.id}`;
      let stale;
      if (fresh) {
        if (await this.store.cacheGet('failure:' + candidate.provider) != null) throw new ProviderError('来源暂不可用，稍后自动重试', 'blocked');
      } else {
        const cached = await this._cached(key, candidate.provider);
        /* A copy parsed by an older parser misses newer line data (vocal parts): refetch,
         * but keep it around — a stale answer still beats an error when the source is down. */
        if (cached !== undefined) { if (cached.parser === PARSER_VERSION) return cached; stale = cached; }
      }
      try {
        const requests = fetchRequests(candidate);
        let raw;
        for (let i = 0; ; i++) {
          try { raw = await this._exchange(candidate.provider, requests[i], signal, budget, 1); break; }
          catch (e) { if (i + 1 >= requests.length || e.kind === 'cancelled' || e.kind === 'blocked') throw e; }
        }
        let lyrics;
        if (raw === null) {
          lyrics = parseLrc('', null, candidate.provider);
          if (!fresh) await this.store.cachePut(key, JSON.stringify(lyrics), 21600);
          return lyrics;
        }
        lyrics = lyricsFromResponse(candidate.provider, raw);
        /* A fresh check never erases a cached good copy with a temporary "no lyrics". */
        if (!fresh || lyricsUsable(lyrics)) await this.store.cachePut(key, JSON.stringify(lyrics), lyricsUsable(lyrics) ? 0 : 21600);
        return lyrics;
      } catch (e) { await this._failure(candidate.provider, e); if (stale !== undefined) return stale; throw e; }
    }
    /* One request + parse; a transient service code is retried once. null = HTTP 404. */
    async _exchange(provider, request, signal, budget, retries) {
      for (let attempt = 0; ; attempt++) {
        const response = await this.http.request(provider, request, { signal, budget, retries });
        if (response.status === 404) return null;
        if (response.status >= 400) throw new ProviderError(`${PROVIDER_NAMES[provider]}：HTTP ${response.status}`, 'http');
        try { return parseProviderBody(provider, response.body); }
        catch (e) {
          if (e.kind !== 'transient' || attempt > 0 || (budget && budget.remaining <= 0)) throw e;
          await new Promise(r => setTimeout(r, 1200));
          if (signal && signal.aborted) throw new ProviderError('请求已取消', 'cancelled');
        }
      }
    }
    async _cached(key, provider) {
      const cached = await this.store.cacheGet(key);
      if (cached != null) { this.http.cacheHit(); return JSON.parse(cached); }
      if (await this.store.cacheGet('failure:' + provider) != null) throw new ProviderError('来源暂不可用，稍后自动重试', 'blocked');
      return undefined;
    }
    async _failure(provider, error) {
      if (error && (error.kind === 'cancelled' || error.kind === 'blocked')) return;
      await this.store.cachePut('failure:' + provider, '1', 60);
    }

    /* Automatic matching for the playing track (engine.c: sl_engine_track). */
    async setTrack(track, force = false) {
      if (!force && trackEqual(this.track, track)) return;
      if (this.controller) this.controller.abort();
      const generation = ++this.generation;
      this.track = track ? JSON.parse(JSON.stringify(track)) : null;
      this._install(null);
      this.remote = this.cloud && track && spotifyId(track.uri) ? undefined : null;
      this.remoteUpdate = null;
      if (!track || !track.title) { this._setStatus('等待播放器'); return; }
      const controller = this.controller = new AbortController();
      const current = () => generation === this.generation && !controller.signal.aborted;
      this.busy = true;
      if (force) this.prefetched.delete(trackKey(track));
      try { await this._match(track, force, controller.signal, current, this.ui); }
      catch (e) { if (e !== CANCELLED && current()) { console.error('[spot-lyric]', e); this._setStatus('匹配出错：' + (e.message || e)); } }
      finally { if (current()) { this.busy = false; this._changed(); } }
    }
    /* Upcoming tracks (the next ones in the queue) are matched in the background, one at a
     * time, through the same caches: when one starts playing its lyrics are already there. */
    prefetch(tracks) {
      this.upcoming = (tracks || []).filter(t => t && t.title).slice(0, 2).map(t => JSON.parse(JSON.stringify(t)));
      if (!this.prefetchActive) this._prefetchNext();
    }
    async _prefetchNext() {
      this.prefetchActive = true;
      try {
        for (let track; (track = this.upcoming.shift());) {
          const key = trackKey(track);
          if (trackEqual(this.track, track) || this.prefetching.has(key) || Date.now() - (this.prefetched.get(key) || 0) < 600000) continue;
          const signal = new AbortController().signal;
          const done = this._match(track, false, signal, () => true, SILENT)
            .catch(e => { if (e !== CANCELLED) console.warn('[spot-lyric] prefetch', e); });
          this.prefetching.set(key, done);
          await done;
          this.prefetching.delete(key);
          this.prefetched.set(key, Date.now());
          if (this.prefetched.size > 50) this.prefetched.delete(this.prefetched.keys().next().value);
        }
      } finally { this.prefetchActive = false; }
    }
    async _match(track, force, signal, current, ui = this.ui) {
      const check = () => { if (!current()) throw CANCELLED; };
      const key = trackKey(track);
      /* Already being matched in the background: wait for it and use its result. */
      const pending = !force && ui !== SILENT && this.prefetching.get(key);
      if (pending) { ui.status('正在匹配歌词'); await pending; check(); }
      const visible = ui !== SILENT;
      const local = await this.store.kvGet('local-lyrics:' + key); check();
      if (local && !force) {
        const lyrics = JSON.parse(local);
        if (lyricsUsable(lyrics)) {
          ui.install(lyrics, null, null, 'local'); this.http.cacheHit(); ui.status('本地歌词');
          if (visible) this._learnRemote(track, signal, current);
          return;
        }
      }
      let { candidate: saved, manual, instrumental } = await this.store.matchGet(track); check();
      /* Lyrics uploaded to the lyrics server (by anyone) come before automatic matching; a
       * binding chosen on this machine comes first ("重新自动匹配" skips both). */
      let remoteKnown = false;
      if (!force && !manual && this.cloud && spotifyId(track.uri)) {
        const doc = await this._cloudGet(track, signal); check();
        if (visible) { this.remote = doc; remoteKnown = true; }
        if (doc) {
          const lyrics = await this._cloudLyrics(track, doc, signal); check();
          const name = PROVIDER_NAMES[(doc.match && doc.match.provider) || doc.source] || '';
          ui.install(lyrics, null, candidateFromJson(doc.match), 'cloud');
          ui.status(`云端歌词${name ? ' · ' + name : ''}`);
          /* The bound provider song may have newer lyrics than the stored copy: check. */
          if (visible) this.updateCheck = this._checkCloudUpdate(track, doc, signal, current);
          return;
        }
      }
      if (visible && !remoteKnown) this._learnRemote(track, signal, current);
      if (saved && !manual) { const verified = saved.verified; matchScore(track, saved); if (!saved.eligible && !verified) saved = null; }
      /* A manual "纯音乐" mark binds no provider song: the flag in the matches store is
       * the whole answer — it survives cache clears and short-circuits every rematch. */
      if (manual && instrumental && !force) {
        ui.install(finalizeLyrics(emptyLyrics('local'), 'instrumental'), null, null, 'manual');
        ui.status('纯音乐，没有歌词'); return;
      }
      const lyricsKey = TRACK_CACHE + key, negativeKey = NEGATIVE + key;
      if (!force) {
        const cached = await this.store.cacheGet(lyricsKey); check();
        if (cached) {
          const entry = JSON.parse(cached);
          /* Lyrics parsed by an older parser lack newer line data (vocal parts): refetch
           * from the bound source instead of serving the stale copy forever. */
          if (lyricsUsable(entry.lyrics) && entry.lyrics.parser === PARSER_VERSION && (saved || entry.lyrics.source === 'spotify')) {
            ui.install(entry.lyrics, entry.colors, entry.match && candidateFromJson(entry.match), entry.origin || (manual ? 'manual' : 'auto'));
            this.http.cacheHit();
            ui.status(manual ? '已绑定歌词 · 缓存' : '歌词缓存'); return;
          }
          /* A deliberately bound song without a lyric body restores as-is: an instrumental
           * marks the track as 纯音乐; the bound song itself lets the comments view resolve
           * that provider song's comment area. */
          if (manual && entry.lyrics && entry.lyrics.note && entry.match) {
            ui.install(entry.lyrics, entry.colors, candidateFromJson(entry.match), 'manual');
            this.http.cacheHit();
            ui.status(entry.lyrics.note === 'instrumental' ? '纯音乐，没有歌词' : `没有歌词 · 已绑定 ${PROVIDER_NAMES[entry.match.provider] || entry.match.provider}`);
            return;
          }
        }
        const negative = await this.store.cacheGet(negativeKey); check();
        if (negative && !manual) { this.http.cacheHit(); ui.status(negative); return; }
      } else {
        await this.store.cacheRemove(lyricsKey); await this.store.cacheRemove(negativeKey);
        if (saved) await this.store.cacheRemove(`${LYRICS_CACHE}:${saved.provider}:${saved.id}`);
        check();
      }
      const job = {
        track, key, preferred: this._preferred(), candidates: [], fetched: new Set(), failed: false,
        searches: { remaining: 6 }, lyricsBudget: { remaining: 3 }, signal, check, ui,
      };
      ui.status('正在匹配歌词');
      const settings = this.deps.settings();
      if (settings.spotify_first && !saved) {
        const result = await this._spotify(job);
        if (result && lyricsUsable(result.lyrics)) return this._complete(job, result.lyrics, 'Spotify 歌词', result.colors, null, 'spotify');
        job.spotifyTried = result !== undefined;
      }
      if (saved) {
        job.candidates.push(saved); job.fetched.add(`${saved.provider}:${saved.id}`);
        if (await this._tryCandidate(job, saved, manual)) return;
      }
      for (const query of searchQueries(track)) {
        if (job.searches.remaining <= 0) break;
        /* The title-only query is a last resort (LDDC): it only runs when nothing eligible turned up. */
        if (query.titleOnly && job.candidates.some(c => c.eligible)) break;
        /* Both sources are searched together; the preferred one wins near-ties (matchSelect). */
        await Promise.all(PROVIDERS.map(provider => this._search(job, provider, query.text)));
        check();
        while (await this._fetchBest(job)) { /* next eligible candidate when one has no lyrics */ }
        if (job.done) return;
      }
      /* Spotify's own lyrics are the fallback after both external sources. */
      if (!job.spotifyTried) {
        const result = await this._spotify(job);
        if (result !== undefined) {
          if (result && lyricsUsable(result.lyrics)) {
            if (this.deps.settings().verify_lyrics !== false && await this._verifyByLyrics(job, result)) return;
            return this._complete(job, result.lyrics, 'Spotify 歌词', result.colors, null, 'spotify');
          }
          return this._complete(job, null, job.failed ? '请求失败，可手动重试' : '未匹配，可手动选择歌词');
        }
      }
      return this._complete(job, null, job.failed ? '来源暂不可用，60 秒后可重试' : '未匹配，可手动选择歌词');
    }
    async _search(job, provider, query) {
      let result = [];
      try { result = await this.providerSearch(provider, query, job.signal, job.searches); }
      catch (e) { if (e.kind === 'cancelled') throw CANCELLED; if (e.kind !== 'blocked' || !/预算/.test(e.message)) job.failed = true; }
      for (const candidate of result) {
        if (job.candidates.some(o => o.provider === candidate.provider && o.id === candidate.id)) continue;
        job.candidates.push(matchScore(job.track, candidate));
      }
    }
    /* undefined: Spotify lyrics not applicable (no id / no lyrics flag); null: miss. */
    async _spotify(job) {
      if (!this.deps.spotify || !spotifyId(job.track.uri)) return undefined;
      try { const r = await this.deps.spotify(job.track, job.signal); job.check(); return r; }
      catch (e) { if (e === CANCELLED || job.signal.aborted) throw CANCELLED; if (e.kind !== 'denied') job.failed = true; return null; }
    }
    _verifyPool(job) {
      const flags = versionFlags(job.track.title), main = (job.track.artists || [])[0];
      const pool = job.candidates.filter(c => !job.fetched.has(`${c.provider}:${c.id}`) && c.delta_ms >= 0 &&
        c.delta_ms <= DURATION_TOLERANCE && versionFlags(c.title) === flags &&
        (c.artist_score >= 0.75 || (scriptsDiffer(main, (c.artists || [])[0]) && (c.title_score >= 0.5 || scriptsDiffer(job.track.title, c.title)))));
      return matchSort(pool, job.preferred);
    }
    /* Metadata could not decide (romaji vs kanji titles, "Eason Chan" vs 「陈奕迅」).
     * If Spotify has the lyrics, accept a same-length (±3 s), same-version candidate
     * only when its lyric text matches Spotify's. Keeps translations / word timing. */
    async _verifyByLyrics(job, spotify) {
      const pool = this._verifyPool(job);
      const budget = { remaining: 3 };
      for (const candidate of pool.slice(0, 3)) {
        job.fetched.add(`${candidate.provider}:${candidate.id}`);
        let lyrics = null;
        try { lyrics = await this.providerFetch(candidate, job.signal, budget); }
        catch (e) { if (e.kind === 'cancelled') throw CANCELLED; continue; }
        job.check();
        if (!lyricsUsable(lyrics)) continue;
        const similarity = lyricsSimilarity(spotify.lyrics, lyrics);
        if (similarity < 0.6) continue;
        candidate.verified = true;
        await this.store.matchSave(job.track, candidate, false);
        await this._complete(job, lyrics, `已匹配歌词 · ${PROVIDER_NAMES[candidate.provider]}（歌词比对 ${Math.round(similarity * 100)}%）`, spotify.colors, candidate, 'verified');
        return true;
      }
      return false;
    }
    async _fetchBest(job) {
      if (job.done || job.lyricsBudget.remaining <= 0) return false;
      const best = matchSelect(job.candidates.filter(c => !job.fetched.has(`${c.provider}:${c.id}`)), job.preferred);
      if (!best) return false;
      job.fetched.add(`${best.provider}:${best.id}`);
      return !(await this._tryCandidate(job, best, false)) && !job.done;
    }
    async _tryCandidate(job, candidate, manual) {
      let lyrics = null;
      try { lyrics = await this.providerFetch(candidate, job.signal, job.lyricsBudget); }
      catch (e) { if (e.kind === 'cancelled') throw CANCELLED; job.failed = true; }
      job.check();
      /* An eligible match that the source marks as instrumental is a final answer (LDDC) —
       * except a manual choice, which binds the song itself (comments can then use it). */
      if (lyrics && lyrics.note === 'instrumental') {
        if (!manual) { await this._complete(job, null, '纯音乐，没有歌词'); return true; }
        await this.store.matchSave(job.track, candidate, manual);
        await this._complete(job, lyrics, `纯音乐，没有歌词 · 已绑定 ${PROVIDER_NAMES[candidate.provider]}`, null, candidate, 'manual');
        return true;
      }
      /* A manual choice binds the song itself even when the source keeps no lyric body for
       * it (credits only / uncollected): the binding marks the track and lets comments
       * resolve this provider song's comment area. */
      if (manual && lyrics && lyrics.note) {
        await this.store.matchSave(job.track, candidate, manual);
        await this._complete(job, lyrics, `没有歌词 · 已绑定 ${PROVIDER_NAMES[candidate.provider]}`, null, candidate, 'manual');
        return true;
      }
      if (!lyricsUsable(lyrics)) return false;
      await this.store.matchSave(job.track, candidate, manual);
      await this._complete(job, lyrics, `${manual ? '已绑定' : '已匹配'}歌词 · ${PROVIDER_NAMES[candidate.provider]}`, null, candidate, manual ? 'manual' : 'auto');
      return true;
    }
    async _complete(job, lyrics, status, colors, match, origin) {
      job.check(); job.done = true;
      job.ui.install(lyrics, colors, match, origin);
      if (lyricsUsable(lyrics)) {
        const entry = { lyrics, colors: colors || null, match: match ? candidateJson(match) : null, origin: origin || null };
        await this.store.cachePut(TRACK_CACHE + job.key, JSON.stringify(entry), 0);
        await this.store.cacheRemove(NEGATIVE + job.key);
      } else if (lyrics && lyrics.note && match) {
        /* Bound songs without a lyric body cache like a hit: the next play restores song
         * + status without a refetch (the restore branch above reads this shape). */
        const entry = { lyrics, colors: null, match: candidateJson(match), origin: origin || null };
        await this.store.cachePut(TRACK_CACHE + job.key, JSON.stringify(entry), 0);
        await this.store.cacheRemove(NEGATIVE + job.key);
      } else if (!(job.failed && job.ui === SILENT)) {
        /* A failed background attempt is not remembered: the track is tried again when it plays. */
        await this.store.cachePut(NEGATIVE + job.key, status, job.failed ? 60 : 21600);
      }
      job.check();
      job.ui.status(status);
    }

    /* -------------------------------------------------- lyrics server ---- */
    async _cloudGet(track, signal) {
      const id = spotifyId(track.uri), key = CLOUD_CACHE + id;
      const cached = await this.store.cacheGet(key);
      if (cached != null) {
        this.http.cacheHit();
        const doc = JSON.parse(cached);
        return doc && lyricsUsable(doc.lyrics) ? doc : null;
      }
      let doc = null;
      try { doc = await this.cloud.get(id, signal); this.cloudError = ''; }
      catch (e) { if (e.kind === 'cancelled' || (signal && signal.aborted)) throw CANCELLED; this.cloudError = e.message || String(e); return undefined; }
      const usable = !!(doc && lyricsUsable(doc.lyrics));
      await this.store.cachePut(key, JSON.stringify(usable ? doc : null), usable ? CLOUD_TTL : CLOUD_MISS_TTL);
      return usable ? doc : null;
    }
    /* Lyrics stored by an older parser (e.g. misplaced translations) are re-fetched from the
     * bound source on this machine (the server copy changes only through the upload button). */
    async _cloudLyrics(track, doc, signal) {
      const match = candidateFromJson(doc.match);
      if (!match || doc.lyrics.parser === PARSER_VERSION) return doc.lyrics;
      try {
        const fresh = await this.providerFetch(match, signal, { remaining: 2 });
        return lyricsUsable(fresh) ? fresh : doc.lyrics;
      } catch (e) { if (e.kind === 'cancelled') throw CANCELLED; return doc.lyrics; }
    }
    /** Uploads lyrics, the provider song they came from and the track's offset.
     * local: not a Spotify track; offline: pure local mode (no lyrics server).
     * @returns {Promise<{stored?: string, updated_at?: string, binding?: object, local?: boolean, offline?: boolean, error?: string}>} */
    async _upload(track, candidate, lyrics) {
      const id = spotifyId(track.uri);
      if (!id) return { local: true };
      if (!this.cloud) return { offline: true };
      try {
        const answer = await this.cloud.put(trackPayload(track), candidate, lyrics, this.trackOffset(track));
        await this.store.cachePut(CLOUD_CACHE + id, JSON.stringify(answer.binding || null), CLOUD_TTL);
        return { stored: answer.stored || 'server', updated_at: answer.updated_at || '', binding: answer.binding || null };
      } catch (e) { return { error: e.message || String(e) }; }
    }
    /* The stored binding came from a provider song whose lyrics may have been corrected
     * since they were uploaded. Once an hour per track the provider is asked for its
     * current copy; a difference is offered at the upload button (remoteUpdate). */
    async _checkCloudUpdate(track, doc, signal, current) {
      try {
        const match = candidateFromJson(doc.match);
        if (!match || !lyricsUsable(doc.lyrics)) return;
        const key = 'update-check:' + trackKey(track);
        if (await this.store.cacheGet(key) != null) return;
        const fresh = await this.providerFetch(match, signal, { remaining: 2 }, true);
        await this.store.cachePut(key, '1', 3600);
        if (!current() || !lyricsUsable(fresh) || lyricsDigest(fresh) === lyricsDigest(doc.lyrics)) return;
        this.remoteUpdate = { lyrics: fresh, match };
        this._changed();
      } catch (e) { /* a failed check simply offers nothing */ }
    }
    /* Takes the platform's newer copy offered by remoteUpdate: it goes on screen and,
     * through the normal upload path, onto the server (bound match + track offset). */
    async applyRemoteUpdate() {
      const update = this.remoteUpdate;
      if (!update || !this.track) return false;
      this.remoteUpdate = null;
      this._install(update.lyrics, null, update.match, 'cloud');
      const name = PROVIDER_NAMES[update.match.provider] || update.match.provider;
      this._setStatus(`云端歌词已更新 · ${name}`);
      await this.upload();
      return true;
    }
    /* The server copy of the playing track, learnt in the background when the lyrics on
     * screen did not come from it (for the upload button's state). */
    _learnRemote(track, signal, current) {
      if (!this.cloud || !spotifyId(track.uri)) { this.remote = null; return; }
      this._cloudGet(track, signal).then(doc => { if (current()) { this.remote = doc; this._changed(); } }, () => {});
    }
    /* What the lyrics server holds for the playing track right now (not the local copy):
     * null when nothing is stored. Throws when the server cannot be reached. */
    async remoteBinding() {
      const track = this.track, id = spotifyId(track && track.uri);
      if (!id || !this.cloud) return null;
      const doc = await this.cloud.get(id);
      const usable = !!(doc && lyricsUsable(doc.lyrics));
      await this.store.cachePut(CLOUD_CACHE + id, JSON.stringify(usable ? doc : null), usable ? CLOUD_TTL : CLOUD_MISS_TTL);
      if (this.track === track) { this.remote = usable ? doc : null; this._changed(); }
      return usable ? doc : null;
    }
    /* The upload button: the lyrics on screen, the provider song they came from (if any) and
     * the track's offset, all together. Nothing else ever writes to the lyrics server. */
    async upload() {
      const track = this.track, lyrics = this.lyrics;
      if (!track || !lyricsUsable(lyrics)) throw new ProviderError('当前没有可上传的歌词', 'failed');
      if (lyrics.source === 'spotify') throw new ProviderError('Spotify 官方歌词受版权保护，不上传到服务器', 'denied');
      if (!spotifyId(track.uri)) throw new ProviderError('本地文件没有 Spotify 曲目 ID，无法上传', 'denied');
      if (!this.cloud) throw new ProviderError('纯本地模式不连接歌词服务器', 'denied');
      /* The offset on screen is uploaded: keep it on this machine too (it may come from the old copy). */
      const offset = this.trackOffset(track);
      const result = await this._upload(track, this.match, lyrics);
      if (result.error) throw new ProviderError(result.error, 'failed');
      if (this.track === track) {
        this.store.set(OFFSET_KEY + trackKey(track), String(offset));
        this.remote = result.binding || null; this.origin = 'cloud'; this.remoteUpdate = null; this._changed();
      }
      return result;
    }

    /* Manual search always queries both providers so the panel can show one
     * page per source, including the ones that failed or returned nothing. */
    async search(query) {
      const groups = PROVIDERS.map(provider => ({ provider, searched: false, error: null, candidates: [] }));
      const all = [];
      const track = this.track || { title: '', artists: [], album: '', duration_ms: 0 };
      const budget = { remaining: 6 };
      if (query && query.length <= 2048) {
        await Promise.all(PROVIDERS.map(async (provider, stage) => {
          if ((query.includes('y.qq.com/') && stage === 0) || (query.includes('music.163.com/') && stage === 1)) return;
          groups[stage].searched = true;
          try {
            for (const candidate of await this.providerSearch(provider, query, null, budget)) all.push(matchScore(track, candidate));
          } catch (e) { groups[stage].error = e.message || String(e); }
        }));
      }
      const preferred = this._preferred();
      matchSort(all, preferred);
      const automatic = matchSelect(all, preferred);
      const { candidate: saved, manual } = this.track ? await this.store.matchGet(this.track) : { candidate: null, manual: false };
      const bound = this.origin === 'cloud' && this.match ? this.match : manual ? saved : null;
      for (const candidate of all) {
        candidate.auto_selected = candidate === automatic;
        const same = (c) => !!(c && c.provider === candidate.provider && c.id === candidate.id);
        candidate.bound = same(bound);
        candidate.verified = !candidate.bound && same(saved) && !manual && !!saved.verified;
        groups[PROVIDERS.indexOf(candidate.provider)].candidates.push(candidate);
      }
      return { candidates: all, providers: groups };
    }
    preview(candidate) { return this.providerFetch(candidate, null, { remaining: 2 }); }
    /* "使用此歌词" / "绑定此歌曲": bound on this machine only (the upload button shares it).
     * A song without a lyric body (note set) binds too: it marks the track — an
     * instrumental answers "纯音乐" — and lets comments resolve the provider song. */
    async bind(candidate, lyrics) {
      const note = lyrics && lyrics.note;
      if ((!lyricsUsable(lyrics) && !note) || !this.track) return false;
      this._interrupt();
      const track = this.track, key = trackKey(track);
      this.prefetched.delete(key);
      await this.store.matchSave(track, candidate, true);
      await this.store.kvSet('local-lyrics:' + key, '');
      await this.store.cacheRemove(NEGATIVE + key);
      await this.store.cachePut(TRACK_CACHE + key, JSON.stringify({ lyrics, colors: null, match: candidateJson(candidate), origin: 'manual' }), 0);
      this._install(lyrics, null, candidate, 'manual');
      this._setStatus(note === 'instrumental' ? `纯音乐，没有歌词 · 已绑定 ${PROVIDER_NAMES[candidate.provider]}`
        : note ? `没有歌词 · 已绑定 ${PROVIDER_NAMES[candidate.provider]}` : `已绑定歌词 · ${PROVIDER_NAMES[candidate.provider]}`);
      return true;
    }
    /* "标记为纯音乐": the answer needs no provider song at all. The mark lives in the
     * matches store (like a manual binding it survives cache clears) until unbound. */
    async markInstrumental() {
      if (!this.track) return false;
      this._interrupt();
      const track = this.track, key = trackKey(track);
      this.prefetched.delete(key);
      await this.store.matchSave(track, null, true, true);
      await this.store.kvSet('local-lyrics:' + key, '');
      await this.store.cacheRemove(TRACK_CACHE + key);
      await this.store.cacheRemove(NEGATIVE + key);
      this._install(finalizeLyrics(emptyLyrics('local'), 'instrumental'), null, null, 'manual');
      this._setStatus('纯音乐，没有歌词');
      return true;
    }
    /* Drops the binding and local lyrics on this machine, then matches again (the server copy,
     * if any, applies again). remote: also delete the copy on the lyrics server. */
    async unbind({ remote = false } = {}) {
      if (!this.track) return;
      const track = this.track, id = spotifyId(track.uri);
      let error = null;
      this.prefetched.delete(trackKey(track));
      await this.store.matchRemove(track);
      await this.store.kvSet('local-lyrics:' + trackKey(track), '');
      if (remote && this.cloud && id) {
        try { await this.cloud.remove(trackPayload(track)); } catch (e) { error = e; }
        await this.store.cacheRemove(CLOUD_CACHE + id);
      }
      this.track = null;
      await this.setTrack(track);
      if (error) throw error;
    }
  }

  /* ----------------------------------------------------- lyrics server ---- */
  /* Client of the lyrics server (server/): it stores shared matches + lyrics and,
   * when the Spotify renderer cannot reach NetEase / QQ itself (CORS), relays the
   * provider requests built here. All matching logic stays on the client. */
  class Cloud {
    /** transport(method, path, body: string|null, signal) -> Promise<{status, body: string}> */
    constructor(transport) {
      this.transport = transport;
      this.stats = { requests: 0, sent_bytes: 0, received_bytes: 0 };
    }
    async call(method, path, payload, signal, allowMissing) {
      const body = payload == null ? null : JSON.stringify(payload);
      this.stats.requests++;
      this.stats.sent_bytes += path.length + (body ? body.length : 0) + 200;
      let response;
      try { response = await this.transport(method, path, body, signal); }
      catch (e) {
        if (signal && signal.aborted) throw new ProviderError('请求已取消', 'cancelled');
        throw e instanceof ProviderError ? e : new ProviderError('无法连接歌词服务器', 'network');
      }
      this.stats.received_bytes += (response.body || '').length + 200;
      if (allowMissing && response.status === 404) return null;
      let data = null;
      try { data = JSON.parse(response.body); } catch (_) { /* below */ }
      if (response.status !== 200 || !data || typeof data !== 'object') {
        const message = data && data.error ? data.error : `歌词服务器错误 ${response.status}`;
        const error = new ProviderError(message, response.status === 429 ? 'blocked' : response.status >= 500 || !response.status ? 'network' : 'failed');
        error.status = response.status;
        throw error;
      }
      return data;
    }
    async get(id, signal) { const answer = await this.call('GET', `/api/bindings/${encodeURIComponent(id)}`, null, signal, true); return answer ? answer.binding || null : null; }
    put(track, candidate, lyrics, offset) {
      const clean = sanitizeLyrics(lyrics);
      if (!clean) return Promise.reject(new ProviderError('歌词为空', 'failed'));
      const payload = { track, candidate: candidate ? candidateJson(candidate) : null, lyrics: clean };
      if (offset != null) payload.offset_ms = clampOffset(offset);
      return this.call('POST', '/api/bind', payload);
    }
    remove(track) { return this.call('POST', '/api/unbind', { track }); }
    /* Same contract as an Http transport: resolves {status, body, retryAfter, setCookie}.
     * set_cookie carries the NetEase sign-in cookie across the relay (server >= this version). */
    async relay(req, signal) {
      const answer = await this.call('POST', '/api/relay', { method: req.method, url: req.url, headers: req.headers || {}, body: req.body == null ? null : String(req.body) }, signal);
      const cookies = Array.isArray(answer.set_cookie) ? answer.set_cookie.filter(c => typeof c === 'string') : undefined;
      return { status: answer.status | 0, body: typeof answer.body === 'string' ? answer.body : '', retryAfter: answer.retry_after || null, setCookie: cookies };
    }
  }

  /* Lyrics received from a client (upload / "使用此歌词"): bounded and stripped to
   * the known shape. Returns null when nothing usable remains. */
  const LYRIC_SOURCES = ['netease', 'qq', 'local', 'spotify'];
  function sanitizeLyrics(input) {
    if (!input || typeof input !== 'object' || !Array.isArray(input.lines)) return null;
    const time = v => Number.isFinite(v) ? Math.max(-3600000, Math.min(86400000, Math.trunc(v))) : 0;
    const text = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, max) : '';
    const sync = ['word', 'line', 'unsynced'].includes(input.sync_type) ? input.sync_type : 'line';
    const source = LYRIC_SOURCES.includes(input.source) ? input.source : 'local';
    const result = { source, provider: source, sync_type: sync, parser: Number.isInteger(input.parser) ? input.parser : 0, lines: [] };
    for (const line of input.lines.slice(0, 5000)) {
      if (!line || typeof line !== 'object') continue;
      const start = time(line.start_time_ms);
      const out = { text: text(line.text, 500), start_time_ms: start, end_time_ms: Math.max(start, time(line.end_time_ms)), words: [] };
      const translated = text(line.translated_text, 500);
      if (translated) out.translated_text = translated;
      if (Number.isInteger(line.part) && line.part >= 0 && line.part <= 999) out.part = line.part;
      const marker = text(line.part_marker, 20); if (marker) out.part_marker = marker;
      if (line.alt === true) out.alt = true;
      if (Number.isFinite(line.part_end)) out.part_end = Math.max(start, time(line.part_end));
      if (sync === 'word' && Array.isArray(line.words)) {
        for (const word of line.words.slice(0, 400)) {
          const wordText = word && typeof word === 'object' ? text(word.text, 200) : '';
          if (!wordText) continue;
          const ws = time(word.start_time_ms);
          out.words.push({ text: wordText, start_time_ms: ws, end_time_ms: Math.max(ws, time(word.end_time_ms)) });
        }
      }
      result.lines.push(out);
    }
    result.lines.sort((a, b) => a.start_time_ms - b.start_time_ms);
    return lyricsUsable(result) ? result : null;
  }

  const api = {
    DURATION_TOLERANCE, PROVIDERS, PROVIDER_NAMES, normalize, toSimplified, textSimilarity, versionFlags, titleBase, titleCore, titleSimilarity,
    artistSimilarity, artistNames, durationDelta, durationScore, matchScore, matchSort, matchSelect, searchQueries, scriptsDiffer,
    trackKey, spotifyId, trackEqual, trackPayload, romanize, lyricsSimilarity,
    candidateFromJson, candidateJson, parseLrc, spotifyLyrics, lyricsUsable, lyricsIndex, exportLrc, sanitizeLyrics, lyricsDigest,
    providerCandidates, searchRequest, fetchRequest, fetchRequests, parseProviderBody, lyricsFromResponse, decodeLyric,
    parseYrc, finalizeLyrics, emptyLyrics, PARSER_VERSION,
    ProviderError, Http, Engine, Cloud,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpotLyricCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
