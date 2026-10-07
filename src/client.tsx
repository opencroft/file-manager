import { defineExtension } from '@ext/host'

import { FileManagerApp } from './app/file-manager-app'

export default defineExtension({
  manifest: {},
  nodes: [],
  provides: {
    apps: [
      {
        type: 'file-manager',
        title: 'File Manager',
        description: "Browse and manage files over terminal sources and the space's S3/FTP connections.",
        icon: 'FolderOpen',
        component: FileManagerApp,
      },
    ],
  },
})
