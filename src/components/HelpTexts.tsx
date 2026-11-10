// 各カードの「？」で開く説明
import {
  ACTIVITY_LEVELS,
  BORDER_RATIO,
  DAILY_ESTIMATE_LIMIT,
  MAX_EXERCISE_LENGTH,
  MAX_REVIEW_GENERATIONS,
  MAX_WEIGHINS_PER_DAY,
  REVIEW_HOUR,
  type CalorieTarget,
  type Plan,
} from '../../shared/calc'
import { formatDate, formatKcal } from '../lib'

export function WeightHelp() {
  return (
    <>
      <h3>記録のしかた</h3>
      <ul>
        <li>
          量った時刻と体重を入れて「記録」を押します。時刻には今の時刻が入っていて、手で直せます。1日{MAX_WEIGHINS_PER_DAY}回まで記録できます。
        </li>
        <li>記録した体重はあとから変更・削除できません。前回より2kg以上違うときは、打ち間違いがないか確認が出ます。</li>
        <li>前の日に記録し忘れたときは、日付を戻せばあとから記録できます。</li>
      </ul>

      <h3>量るタイミング</h3>
      <p>
        体重は食べたものや水分で、1日のうちに0.5〜1.5kgほど増えていきます。1回目はなるべく
        <strong>毎朝同じ条件（起きてトイレの後、食べる前）</strong>
        で量ると、日ごとの変化が正確に分かります。
      </p>

      <h3>計算に使う体重</h3>
      <p>
        摂取ボーダー、今週の目標、グラフには、その日いちばん早い時刻の体重を使います。夜だけ量った日は、その値が使われます（いつもより重めに出ます）。
      </p>

      <h3>AIのひとこと</h3>
      <p>
        今日の体重を記録すると、AIが体重の流れや食事・運動の記録をもとに、ひとことを書きます（1日最大{MAX_WEIGHINS_PER_DAY}回）。過去の日にさかのぼって記録した分にはつきません。
      </p>
    </>
  )
}

export function CalorieHelp({ target, activity }: { target: CalorieTarget; activity: number }) {
  const activityLabel = ACTIVITY_LEVELS.find((a) => a.value === activity)?.label ?? ''
  return (
    <>
      <h3>摂取ボーダーとは</h3>
      <p>
        今の体重を保つのに必要な1日のカロリー（維持カロリー）の{Math.round(BORDER_RATIO * 100)}
        %です。ボーダー以内に抑えると、無理のないペースで体重を減らしやすくなります。
      </p>
      <div className="help-numbers">
        体重 {target.weight.toFixed(1)} kg の場合
        <br />
        基礎代謝 {formatKcal(target.bmr)} kcal × 活動量 {activity}
        <br />= 維持カロリー {formatKcal(target.maintenance)} kcal
        <br />→ ボーダー <strong>{formatKcal(target.border)} kcal</strong>
      </div>
      <ul>
        <li>基礎代謝は、体重・身長・年齢・性別から計算しています（Mifflin-St Jeor式）。</li>
        <li>活動量は設定の「ふだんの活動量」（{activityLabel}）です。</li>
        <li>体重が減ると、ボーダーも少しずつ下がります。</li>
      </ul>

      <h3>記録のしかた</h3>
      <ul>
        <li>食べた時刻とkcalを入れて「追加」を押します。時刻には今の時刻が入っていて、手で直せます。</li>
        <li>内容（何をどれくらい食べたか）も書いておくと、AIのひとことで食事の中身にも触れてくれます。</li>
        <li>まちがえたときは、一覧の「×」で削除できます。</li>
      </ul>

      <h3>写真からカロリーを計算</h3>
      <ul>
        <li>
          「カメラで撮る」でその場で撮るか、「写真を選ぶ」で撮っておいた写真を選び、「AIでカロリーを計算する」を押すと、AIが料理ごとのカロリーの目安を出し、合計をkcalの欄に入れます。写真を選んだだけでは送りません。
        </li>
        <li>
          計算する前に内容の欄に料理名や「ご飯少なめ」「半分残した」などと書いておくと、AIがそれも参考にして計算します（書かなくても計算できます）。計算すると、内容の欄にAIが見分けた料理名が入ります（書いておいた補足は後ろに残ります）。
        </li>
        <li>
          料理名や量が違っていたら、内容の欄を直して「直した内容で計算し直す」を押すと、同じ写真を直した内容で計算し直します。計算し直すたびに1回使います。
        </li>
        <li>写真から量を見積もるので誤差があります。違っていたら数字を直してから追加してください。</li>
        <li>写真は保存されません。1日{DAILY_ESTIMATE_LIMIT}回まで使えて、それ以上は手入力で記録します。</li>
      </ul>
    </>
  )
}

export function ExerciseHelp() {
  return (
    <>
      <p>
        その日にした運動を自由に書いておくと、AIのひとことの参考になります。「30分ウォーキング」「階段を使った」など、簡単なメモで大丈夫です（{MAX_EXERCISE_LENGTH}文字まで）。
      </p>
      <h3>消費カロリーは計算しません</h3>
      <p>
        運動で消費したカロリーは見積もりの誤差が大きく、その分食べてよいと考えると食べすぎにつながりやすいため、計算せず、摂取ボーダーも変えていません。
      </p>
      <h3>書くタイミング</h3>
      <p>
        AIのひとことは体重を記録したときに作られます。その日の2回目の体重を記録する前に書いておくと、そのときのひとことに反映されます。
        夜{REVIEW_HOUR}時ごろの「今日のまとめ」までに書いておけば、まとめにも入ります。
      </p>
      <p>空にして保存すると、その日の記録を消せます。</p>
    </>
  )
}

export function ReviewHelp() {
  return (
    <>
      <p>
        毎晩{REVIEW_HOUR}時ごろ、その日の体重・食事・運動の記録をもとに、AIが1日をまとめて振り返ります。体重を記録したときのひとことと違い、1日分の記録がそろった状態で書きます。
      </p>
      <ul>
        <li>何も記録していない日は作られません。</li>
        <li>
          {REVIEW_HOUR}時より後に食事などを記録したときは「作り直す」で、足した記録を入れて作り直せます（1日{MAX_REVIEW_GENERATIONS - 1}回まで）。
        </li>
        <li>{REVIEW_HOUR}時の時点で記録がなく作られなかった日も、あとから「まとめを作る」で作れます（今日と昨日の分）。</li>
        <li>前の日のまとめは、日付を戻すと読めます。</li>
      </ul>
      <h3>通知</h3>
      <p>
        設定の「夜のまとめの通知」をオンにすると、まとめができたときにスマホに通知が届きます。通知を押すと、その日のまとめが開きます。通知には記録の中身は表示されません。
      </p>
    </>
  )
}

export function WeekHelp({ plan }: { plan: Plan }) {
  const w = plan.current
  return (
    <>
      <p>
        目標（何kgを何週間で減らすか）から、1週間ごとに減らす量を決めています。当初の計画は週 −{plan.initialWeeklyLoss.toFixed(2)}{' '}
        kg（全{Math.ceil(plan.totalWeeks)}週）です。
      </p>
      <h3>毎週の割り直し</h3>
      <p>
        毎週の始まりに、その時点の体重（直近4日の平均）から、ゴールまでの残りを残りの期間で割り直します。順調なら次の週の目標は軽くなり、遅れていれば少し重くなります。
      </p>
      {w && (
        <div className="help-numbers">
          今週（{formatDate(w.startDate)}〜{formatDate(w.endDate)}）
          <br />
          週の始まりの体重 {w.refWeight.toFixed(1)} kg
          <br />→ 今週の目標 −{w.targetLoss.toFixed(2)} kg（週末に {w.targetWeight.toFixed(1)} kg）
          <br />
          ゴール {plan.targetWeight.toFixed(1)} kg
        </div>
      )}
      <h3>ペースの目安</h3>
      <p>
        1週間に体重の1%より速く減らすのは体への負担が大きいとされるため、それを超える週は注意を表示します。きついと感じたら、設定から期間を延ばして目標を作り直せます。
      </p>
    </>
  )
}
