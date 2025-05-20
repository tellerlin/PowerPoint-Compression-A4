<script>
  import ToolNavigation from '$lib/components/ToolNavigation.svelte';
</script>

<div class="container mx-auto px-4 py-8">
  <h1 class="text-3xl font-bold text-center mb-8">Audio Editing</h1>
  
  <ToolNavigation />
  
  <div class="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6">
    <div class="text-center mb-6">
      <h2 class="text-xl font-semibold mb-2">Edit Your Audio Files</h2>
      <p class="text-gray-600">Trim, cut, and edit your audio files</p>
    </div>
    
    <div class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
      <input
        type="file"
        accept="audio/*"
        class="hidden"
        id="fileInput"
      />
      <label
        for="fileInput"
        class="cursor-pointer inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200"
      >
        Select Audio File
      </label>
      <p class="mt-2 text-sm text-gray-500">or drag and drop your file here</p>
    </div>
    
    <div class="mt-6 text-center">
      <button
        class="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        disabled
      >
        Edit Audio
      </button>
    </div>
  </div>
</div> 