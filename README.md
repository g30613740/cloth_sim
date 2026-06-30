<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Симуляция ткани WebGPU + PBD</title>
</head>
<body>
    <div class="container">
        <h1>Симуляция ткани на WebGPU + PBD</h1>
        <p>
            <span class="badge">WebGPU</span>
            <span class="badge">WGSL</span>
            <span class="badge">PBD</span>
            <span class="badge">JavaScript</span>
        </p>
        <p>
            <strong>Автор:</strong> @g30613740<br>
            <strong>Репозиторий:</strong> <a href="https://github.com/g30613740/cloth_sim" target="_blank">https://github.com/g30613740/cloth_sim</a>
        </p>

        <h2>Описание</h2>
        <p>
            Этот проект реализует <strong>интерактивную симуляцию ткани</strong> с использованием метода 
            <strong>Position Based Dynamics (PBD)</strong> и рендеринга через <strong>WebGPU</strong> (без сторонних движков).
            Ткань представлена сеткой из треугольников, углы которой закреплены, а центральная вершина колеблется по синусу, 
            создавая волны. Также реализован чекбокс для включения/отключения гравитации.
        </p>

        <h2>Запуск</h2>
        <p>Для работы необходим браузер с поддержкой WebGPU (рекомендуется <strong>Chrome Canary</strong> с включёнными флагами <code>#enable-unsafe-webgpu</code>).</p>
        <ol>
            <li>Клонируйте репозиторий:
                <pre>git clone https://github.com/ваш-логин/название-репозитория.git</pre>
            </li>
            <li>Перейдите в папку проекта и запустите локальный веб-сервер (например, <strong>Live Server</strong> в VS Code или <code>npx serve</code>).</li>
            <li>Откройте <code>http://localhost:5500</code> в браузере.</li>
        </ol>
        <p>Если вы используете Chrome Canary, убедитесь, что включены флаги <code>#enable-unsafe-webgpu</code> и <code>#enable-webgpu-developer-features</code>.</p>

        <h2>Текущий статус реализации</h2>
        <div class="status">
            <span class="status-item done">✅ Инициализация WebGPU</span>
            <span class="status-item done">✅ Отрисовка треугольника (проверка)</span>
            <span class="status-item done">✅ Генерация сетки ткани (каркас)</span>
            <span class="status-item todo">⏳ Симуляция PBD (compute-шейдер)</span>
            <span class="status-item todo">⏳ Управление гравитацией</span>
            <span class="status-item todo">⏳ Анимация центральной вершины</span>
        </div>

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

    </div>
</body>
</html>