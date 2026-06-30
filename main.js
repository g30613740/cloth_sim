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

/////////////////////////////////////////////////////////////////
// шейдеры - небольшие программы, выполн. на  GPU, а не на CPU //
/////////////////////////////////////////////////////////////////

// вершинный шейдер: преобразует к-ты вершин в к-ты вершин на экране
const vertexShaderCode = `
@vertex
// ф-ия vs_main берёт 3 вещ. числа и преобр. в 4мерный в-ор clip-space
fn vs_main(@location(0) pos: vec3<f32>) -> @builtin(position) vec4<f32> {
	return vec4<f32>(pos, 1.0);
}
`;

// фрагментный шейдер: опр. цвет каждого пикселя
const fragmentShaderCode = `
@fragment
fn fs_main() -> @location(0) vec4<f32> {
	return vec4<f32>(0.0, 0.8, 0.8, 1.0); // цвет
}
`;

/////////////////////////
// данные треугольника //
/////////////////////////

// к-ты вершин на отрезке [-1, 1]
const vertices = new Float32Array([
	-0.5, -0.5, 0.0,
	0.5, -0.5, 0.0,
	0.0, 0.5, 0.0
])

// буфер для хранения вершин на GPU
const vertexBuffer = device.createBuffer({
	size: vertices.byteLength,
	// флаги для использования
	// вершинный буфер | копирование данных из CPU в этот буфер
	usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(vertexBuffer, 0, vertices);

// индексы (порядок отрисовки вершин)
const indices = new Uint32Array([0, 1, 2]); // соединяем вершины 1, 2, 3
const indexBuffer = device.createBuffer({
	size: indices.byteLength,
	usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
});
// копируем данные (массив vertices) из CPU в GPU (начинаем с 0 позиции)
device.queue.writeBuffer(indexBuffer, 0, indices);

/////////////////////////////////////////////////
// пайплайн рендеринга - настраиваем рисование //
/////////////////////////////////////////////////

const pipeline = device.createRenderPipeline({
	layout: 'auto',
	// настройки вершинного шейдера
	vertex: {
		module: device.createShaderModule({ code: vertexShaderCode}),
		entryPoint: 'vs_main',
		// описываем, как читать вершинный буфер
		buffers: [
			{
				arrayStride: 3 * 4, // 3 float по 4 байта, шаг между верш в байтах
				attributes: [
					{
						shaderLocation: 0, // соответствует @location(0) в шейдере
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
		topology: 'triangle-list',
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
	renderPass.setPipeline(pipeline);
	renderPass.setVertexBuffer(0, vertexBuffer);
	renderPass.setIndexBuffer(indexBuffer, 'uint32');
	renderPass.drawIndexed(3);

	renderPass.end();

	// отправляем команды на исполнение
	device.queue.submit([encoder.finish()]);

	// запрашиваем следующий кадр
	requestAnimationFrame(frame);
}

// запуск цикла
frame();