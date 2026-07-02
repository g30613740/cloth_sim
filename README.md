<h1>Симуляция ткани на WebGPU + PBD</h1>

<p>
  <strong>Технологии:</strong> WebGPU, WGSL, PBD, JavaScript<br>
  <strong>Автор:</strong> @g30613740<br>
  <strong>Репозиторий:</strong> <a href="https://github.com/g30613740/cloth_sim">https://github.com/g30613740/cloth_sim</a>
</p>

<hr>

<h2>Описание</h2>
<p>
  Этот проект реализует интерактивную симуляцию ткани с использованием метода Position Based Dynamics (PBD) и рендеринга через WebGPU (без сторонних движков).<br>
  Ткань представлена сеткой из треугольников, углы которой закреплены, а центральная вершина колеблется по синусу, создавая волны. Также реализован чекбокс для включения/отключения гравитации.
</p>

<h2>Запуск</h2>
<p>Для работы необходим браузер с поддержкой WebGPU (рекомендуется <strong>Chrome Canary</strong> с включёнными флагами <code>#enable-unsafe-webgpu</code>).</p>
<ol>
  <li>Клонируйте репозиторий:
    <pre>git clone https://github.com/g30613740/cloth_sim.git</pre>
  </li>
  <li>Перейдите в папку проекта и запустите локальный веб-сервер (например, <strong>Live Server</strong> в VS Code или <code>npx serve</code>).</li>
  <li>Откройте <code>http://localhost:5500</code> в браузере.</li>
</ol>
<p>Если вы используете Chrome Canary, убедитесь, что включены флаги <code>#enable-unsafe-webgpu</code> и <code>#enable-webgpu-developer-features</code>.</p>

<h2>Текущий статус реализации</h2>
<ul>
  <li><input type="checkbox" checked disabled> Инициализация WebGPU</li>
  <li><input type="checkbox" checked disabled> Отрисовка треугольника (проверка)</li>
  <li><input type="checkbox" checked disabled> Генерация сетки ткани (каркас)</li>
  <li><input type="checkbox" disabled> Симуляция PBD (compute-шейдер)</li>
  <li><input type="checkbox" disabled> Управление гравитацией</li>
  <li><input type="checkbox" disabled> Анимация центральной вершины</li>
</ul>

<h2>Структура проекта</h2>
<ul>
  <li><code>index.html</code> – точка входа, UI (canvas и чекбокс)</li>
  <li><code>main.js</code> – основной код на JavaScript: инициализация WebGPU, шейдеры, буферы, пайплайн, цикл анимации</li>
  <li><code>README.md</code> – описание проекта</li>
  <li><code>.gitignore</code> – список игнорируемых файлов</li>
</ul>

<h2>Технические детали</h2>
<ul>
  <li><strong>Рендеринг:</strong> WebGPU (контекст canvas, пайплайн, вершинный и фрагментный шейдеры на WGSL)</li>
  <li><strong>Симуляция:</strong> PBD с Verlet-интеграцией, ограничения на длины рёбер, итеративная коррекция</li>
  <li><strong>Визуализация:</strong> каркас сетки (line-list), в будущем – заливка треугольников</li>
</ul>

<h2>Планы по развитию</h2>
<ul>
  <li>Реализация compute-шейдера для PBD на GPU</li>
  <li>Динамическое изменение центральной вершины по синусу</li>
  <li>Чекбокс «Включить гравитацию»</li>
  <li>Интерактивное перетаскивание вершин (опционально)</li>
</ul>

<h2>Лицензия</h2>
<p>Проект распространяется под лицензией <strong>MIT</strong>.</p>