require 'xcodeproj'
platform = ARGV.fetch(0, 'ios')
raise 'Expected ios or macos' unless ['ios', 'macos'].include?(platform)
project_path = File.expand_path("../#{platform}/Runner.xcodeproj", __dir__)
project = Xcodeproj::Project.open(project_path)
runner = project.targets.find { |target| target.name == 'Runner' }
raise 'Runner target missing' unless runner
relative = "../native/artifacts/#{platform}/Audiocpp.framework"
reference = project.files.find { |file| file.path == relative } || project.main_group.new_file(relative)
unless runner.frameworks_build_phase.files_references.include?(reference)
  runner.frameworks_build_phase.add_file_reference(reference)
end
phase = runner.copy_files_build_phases.find { |item| item.name == 'Embed audio.cpp' } || runner.new_copy_files_build_phase('Embed audio.cpp')
phase.dst_subfolder_spec = '10'
unless phase.files_references.include?(reference)
  entry = phase.add_file_reference(reference)
  entry.settings = { 'ATTRIBUTES' => ['CodeSignOnCopy', 'RemoveHeadersOnCopy'] }
end
runner.build_phases.delete(phase)
thin_binary_index = runner.build_phases.index { |item| item.respond_to?(:name) && item.name == 'Thin Binary' }
runner.build_phases.insert(thin_binary_index || runner.build_phases.length, phase)
runner.build_configurations.each do |config|
  search_paths = Array(config.build_settings['FRAMEWORK_SEARCH_PATHS'])
  artifact_path = "$(PROJECT_DIR)/../native/artifacts/#{platform}"
  config.build_settings['FRAMEWORK_SEARCH_PATHS'] = (search_paths + ['$(inherited)', artifact_path]).uniq
  paths = Array(config.build_settings['LD_RUNPATH_SEARCH_PATHS'])
  framework_path = platform == 'macos' ? '@executable_path/../Frameworks' : '@executable_path/Frameworks'
  config.build_settings['LD_RUNPATH_SEARCH_PATHS'] = (paths + ['$(inherited)', framework_path]).uniq
end
project.save
puts 'Linked audio.cpp and enabled framework embedding/signing.'
