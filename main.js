// ============================================================
// 1. Инициализация WebGPU
// ============================================================
async function initWebGPU() {
	// проверка наличия объекта navigator.gpu
	if (!navigator.gpu) {
		alert('Browser does not support WebGPU');
		return;
	}

	// получаем адаптер (физ. устройство GPU)
	// navigator.gpu.requestAdapter занимает время, поэтому он возвращает Promise
	// без await мы бы получили не сам адаптер, а Promise
	const adapter = await navigator.gpu.requestAdapter()
	if (!adapter) {
		alert('could not get an adapter GPU');
		return;
	}

	// получаем устройство (логич интерфейс для работы с GPU)
	const device = await adapter.requestDevice();

	// получаем canvas и создаём контекст webgpu
	const canvas = document.getElementById('canvas')
	const context = canvas.getContext('webgpu')

	// выбираем предпочтит для данного браузера формат пикс
	const format = navigator.gpu.getPreferredCanvasFormat();

	// настройка контекста
	context.configure({
		device: device,
		format: format,
		alphaMode: 'opaque', // непрозрачный фон
	})

	console.log('WebGPU is ready to work');
	console.log('Adapter:', adapter);
	console.log('Device:', device);
	console.log('Format of canvas:', format);

	// возвращаем объекты для дальнейшего использования
	return { device, context, format, canvas };
}

// запуск инициализации
const gpu = await initWebGPU();
if (!gpu) {
	// останавливаемся, если что-то не так
	throw new Error('GPU initialization does not work');
}

const { device, context, format } = gpu;

// ============================================================
// 2. Генерация данных ткани (сетка NxN)
// ============================================================
function buildCloth(N, size) {
    // N - количество сегментов по горизонтали и вертикали
    // size - физический размер квадрата (например, 2.0)
    const vertices = [];
    const indices = []; // рёбра – пары индексов

    const step = size / N;
    const half = size / 2;

    // 1) Вершины: (N+1) x (N+1)
    for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++) {
            const x = -half + i * step;
            const y = -half + j * step;
            vertices.push(x, y, 0.0);
        }
    }

    // Функция для получения индекса вершины по (i, j)
    const idx = (i, j) => j * (N + 1) + i;

    // 2) Рёбра: горизонтальные и вертикальные
    // Горизонтальные (i от 0 до N-1, j от 0 до N)
    for (let j = 0; j <= N; j++) {
        for (let i = 0; i < N; i++) {
            const a = idx(i, j);
            const b = idx(i + 1, j);
            indices.push(a, b);
        }
    }
    // Вертикальные (i от 0 до N, j от 0 до N-1)
    for (let j = 0; j < N; j++) {
        for (let i = 0; i <= N; i++) {
            const a = idx(i, j);
            const b = idx(i, j + 1);
            indices.push(a, b);
        }
    }

    return {
        vertices: new Float32Array(vertices),
        indices: new Uint32Array(indices), // используем 32-битные индексы
        numVertices: (N + 1) * (N + 1),
        numEdges: indices.length / 2,
    };
}

// Параметры ткани
const N = 20;          // количество сегментов (20x20 = 400 квадратов)
const size = 2.0;      // размер квадрата в глобальных координатах
const cloth = buildCloth(N, size);

// ============================================================
// 3. Буферы для ткани
// ============================================================
// Вершинный буфер

const vertexBuffer = device.createBuffer({
    size: cloth.vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
// 0 - смещение в байтах, cloth.vertices – это Float32Array (для вершин) или Uint32Array (для индексов)
device.queue.writeBuffer(vertexBuffer, 0, cloth.vertices);

// Индексный буфер (рёбра)
const indexBuffer = device.createBuffer({
    size: cloth.indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(indexBuffer, 0, cloth.indices);

// ============================================================
// 4. Шейдеры
// ============================================================
const vertexShaderCode = `
@vertex
fn vs_main(@location(0) pos: vec3<f32>) -> @builtin(position) vec4<f32> {
    return vec4<f32>(pos, 1.0);
}
`;

const fragmentShaderCode = `
@fragment
fn fs_main() -> @location(0) vec4<f32> {
    return vec4<f32>(0.8, 0.8, 0.8, 1.0); // Светло-серые линии
}
`;

// ============================================================
// 5. Пайплайн рендеринга (теперь line-list)
// ============================================================
const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
        module: device.createShaderModule({ code: vertexShaderCode }),
        entryPoint: 'vs_main',
        buffers: [
            {
                arrayStride: 3 * 4, // 3 float по 4 байта
                attributes: [
                    {
                        shaderLocation: 0,
                        offset: 0,
                        format: 'float32x3',
                    },
                ],
            },
        ],
    },
    fragment: {
        module: device.createShaderModule({ code: fragmentShaderCode }),
        entryPoint: 'fs_main',
        targets: [{ format }],
    },
    primitive: {
        topology: 'line-list', // Рисуем линии (каждые 2 индекса – отрезок)
    },
});


//////////////
// анимация //
//////////////
function frame() {
	// создаём кодировщик команд
	const encoder = device.createCommandEncoder();

	// получаем текущую текстуру кавнваса
	const textureView = context.getCurrentTexture().createView();

	// начинаем проход рендеринга (очистка фона и рисование)
	const renderPass = encoder.beginRenderPass({
		colorAttachments: [
			{
				view: textureView,
				loadOp: 'clear',
				storeOp: 'store',
				clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1.0 },
			},
		],
	});

	// выполняем рисование
	// устанавливаем текущий пайплайн рендеринга со всеми настройками
	renderPass.setPipeline(pipeline);
	// привязывакм буферы
	renderPass.setVertexBuffer(0, vertexBuffer);
	renderPass.setIndexBuffer(indexBuffer, 'uint32');
	// Рисуем все рёбра: количество индексов = cloth.indices.length
	renderPass.drawIndexed(cloth.indices.length);

	renderPass.end();

	// отправляем команды на исполнение
	device.queue.submit([encoder.finish()]);

	// запрашиваем следующий кадр
	requestAnimationFrame(frame);
}

// запуск цикла
frame();